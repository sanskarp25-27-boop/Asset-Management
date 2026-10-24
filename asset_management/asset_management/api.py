"""Server side of the Asset Workspace (page "asset-workspace"): a simple view over ERPNext's standard Assets module.

Nothing here is a separate register. Assets are standard Assets (created and submitted on the Asset form), and
assigning / returning creates and submits a standard Asset Movement (Issue / Receipt), which is what sets the
Asset's Custodian. Hierarchy: Asset Category > Item Group (sub-category) > Item > Asset; see setup.py.
"""

import datetime
import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_datetime, getdate, now_datetime, nowdate

ASSET = "Asset"
MOVEMENT = "Asset Movement"
CATEGORY = "Asset Category"
TYPE = "Asset Category Type"  # Hardware, Subscription, and any the user adds

ASSET_FIELDS = [
	"name", "asset_name", "item_code", "asset_category", "asset_sub_category", "asset_serial_no", "status", "docstatus",
	"custodian", "company", "location", "purchase_date", "net_purchase_amount", "billing_cycle", "warranty_renewal_date",
	"acknowledgement_status", "current_acknowledgement",
]
ACK = "Asset Acknowledgement"
# standard Asset statuses the page shows as something other than Available / Assigned
REPAIR = ("In Maintenance", "Out of Order")
DISPOSED = ("Scrapped", "Sold", "Capitalized")
STATUSES = ["Available", "Assigned", "Draft", "Under Repair", "Disposed"]


def _args(value):
	if isinstance(value, str):
		value = json.loads(value or "{}")
	return frappe._dict(value or {})


def _list(value):
	if isinstance(value, str):
		value = json.loads(value or "[]")
	return value or []


def _read():
	frappe.has_permission(ASSET, "read", throw=True)


def _category_types():
	"""{Asset Category: its Category Type}."""
	return dict(frappe.get_all(CATEGORY, fields=["name", "asset_category_type"], as_list=True))


def _type_info():
	"""{Category Type: {is_subscription, color}} from the Asset Category Type master."""
	return {
		t.name: frappe._dict(is_subscription=bool(t.is_subscription), color=t.color or "gray")
		for t in frappe.get_all(TYPE, fields=["name", "is_subscription", "color"])
	}


def _subscription_types():
	return {name for name, t in _type_info().items() if t.is_subscription}


def _names(employees):
	employees = [e for e in employees if e]
	if not employees:
		return {}
	return dict(frappe.get_all("Employee", filters={"name": ("in", employees)}, fields=["name", "employee_name"], as_list=True))


def _row(a, types, names, since=None, subscription_types=None):
	"""A standard Asset in the shape the page uses."""
	if subscription_types is None:
		subscription_types = _subscription_types()
	category_type = types.get(a.asset_category) or "Hardware"
	if a.docstatus == 0:
		status = "Draft"
	elif a.status in DISPOSED:
		status = "Disposed"
	elif a.status in REPAIR:
		status = "Under Repair"
	else:
		status = "Assigned" if a.custodian else "Available"
	return frappe._dict(
		name=a.name,
		asset_name=a.asset_name,
		item=a.item_code,
		category=a.asset_category,
		sub_category=a.asset_sub_category,
		category_type=category_type,
		# subscriptions show a renewal date and billing cycle, and count as a monthly cost
		is_subscription=category_type in subscription_types,
		status=status,
		erp_status=a.status,
		serial_no=a.asset_serial_no,
		purchase_date=a.purchase_date,
		purchase_cost=a.net_purchase_amount,
		billing_cycle=a.billing_cycle,
		expiry_date=a.warranty_renewal_date,
		assigned_to=a.custodian,
		employee_name=names.get(a.custodian) if a.custodian else None,
		assigned_on=(since or {}).get(a.name) if a.custodian else None,
		company=a.company,
		location=a.location,
		# has the current holder acknowledged receiving it (Pending / Completed)
		acknowledgement=a.get("acknowledgement_status") if a.custodian else None,
		acknowledgement_record=a.get("current_acknowledgement") if a.custodian else None,
	)


def _movements(assets=None, employee=None):
	"""Submitted Asset Movement lines, oldest first."""
	conditions, values = ["m.docstatus = 1"], {}
	if assets is not None:
		if not assets:
			return []
		conditions.append("i.asset in %(assets)s")
		values["assets"] = tuple(assets)
	if employee:
		conditions.append("(i.to_employee = %(employee)s or i.from_employee = %(employee)s)")
		values["employee"] = employee
	lines = frappe.db.sql(
		f"""select m.name as movement, m.purpose, m.transaction_date, m.creation, i.asset, i.from_employee, i.to_employee,
			i.source_location, i.target_location, i.condition_rating, i.condition_notes
		from `tabAsset Movement Item` i join `tabAsset Movement` m on m.name = i.parent
		where {" and ".join(conditions)}
		order by m.transaction_date asc, m.creation asc""",
		values,
		as_dict=True,
	)
	for ln in lines:
		# ERPNext's own Receipt on submitting an asset carries the purchase date only (00:00): when it was entered that
		# same day, the entry time is the real time; an older date stays a date without a time
		when = get_datetime(ln.transaction_date)
		if when.time() == datetime.time(0, 0):
			if getdate(ln.creation) == when.date():
				ln.transaction_date = ln.creation
			else:
				ln.date_only = 1
	return lines


def _acks(assets):
	"""{(asset movement, asset): acknowledgement} for the hand-overs of these assets."""
	if not assets:
		return {}
	rows = frappe.db.sql(
		f"""select a.name, a.status, a.asset_movement, a.acknowledged_on, a.sent_count, a.last_sent_on, a.employee_remarks, i.asset
		from `tab{ACK} Item` i join `tab{ACK}` a on a.name = i.parent where i.asset in %(assets)s""",
		{"assets": tuple(assets)},
		as_dict=True,
	)
	return {(r.asset_movement, r.asset): r for r in rows}


def _periods(lines, acks=None):
	"""Custody periods from movement lines: who held each asset, from when, until when (None = still holds it),
	where it was, its condition at hand-over, location transfers while held, and the acknowledgement."""
	# after each movement the custodian is that line's To Employee (none = back in stock); the location is the
	# last Target Location (an Issue keeps the location it had)
	open_, out, where = {}, [], {}
	for ln in lines:
		before = where.get(ln.asset)
		if ln.target_location:
			where[ln.asset] = ln.target_location
		current = open_.get(ln.asset)
		if current and current["employee"] == ln.to_employee:
			# the same employee keeps it: a location transfer
			if ln.target_location and ln.target_location != before:
				current["transfers"].append({"date": ln.transaction_date, "from": before, "to": ln.target_location, "movement": ln.movement})
				current["location"] = ln.target_location
			continue
		if current:
			current["returned_on"] = ln.transaction_date
			current["returned_by"] = ln.movement
			current["returned_to"] = where.get(ln.asset)
			current["handed_to"] = ln.to_employee  # transferred straight to another employee (none = back in stock)
			del open_[ln.asset]
		if ln.to_employee:
			ack = (acks or {}).get((ln.movement, ln.asset))
			period = {
				"asset": ln.asset, "employee": ln.to_employee, "assigned_on": ln.transaction_date, "movement": ln.movement,
				"returned_on": None, "handed_to": None, "location": where.get(ln.asset), "transfers": [],
				"from_employee": ln.from_employee, "condition": ln.condition_rating, "condition_notes": ln.condition_notes,
				"acknowledgement": ack.name if ack else None, "acknowledgement_status": ack.status if ack else None,
				"acknowledged_on": ack.acknowledged_on if ack else None, "employee_remarks": ack.employee_remarks if ack else None,
			}
			open_[ln.asset] = period
			out.append(period)
	return out


def _timeline(lines, acks=None):
	"""Every movement of the assets as an event: received, assigned, transferred, moved, returned."""
	events, where = [], {}
	for ln in lines:
		source = ln.source_location or where.get(ln.asset)
		if ln.target_location:
			where[ln.asset] = ln.target_location
		moved = bool(ln.target_location and ln.target_location != source)
		if ln.to_employee and not ln.from_employee:
			kind = "Assigned"
		elif ln.to_employee and ln.from_employee and ln.to_employee != ln.from_employee:
			kind = "Transferred"
		elif ln.to_employee and ln.to_employee == ln.from_employee:
			kind = "Moved"
		elif ln.from_employee and not ln.to_employee:
			kind = "Returned"
		else:
			kind = "Received" if ln.purpose == "Receipt" else "Moved"
		ack = (acks or {}).get((ln.movement, ln.asset)) if ln.to_employee and ln.to_employee != ln.from_employee else None
		events.append({
			"asset": ln.asset, "date": ln.transaction_date, "date_only": ln.get("date_only"), "event": kind, "purpose": ln.purpose, "movement": ln.movement,
			"from_employee": ln.from_employee, "to_employee": ln.to_employee,
			"from_location": source if moved else None, "to_location": ln.target_location if moved else where.get(ln.asset),
			"condition": ln.condition_rating, "condition_notes": ln.condition_notes,
			"acknowledgement": ack.name if ack else None, "acknowledgement_status": ack.status if ack else None,
		})
	return events


def _since(asset_names):
	"""When each asset's current custodian got it."""
	since = {}
	for p in _periods(_movements(asset_names)):
		if not p["returned_on"]:
			since[p["asset"]] = getdate(p["assigned_on"])
	return since


def _assets(filters=None, extra=None):
	f = _args(filters)
	conditions = {"docstatus": ("<", 2)}
	for key, field in (("category", "asset_category"), ("sub_category", "asset_sub_category"), ("item", "item_code")):
		if f.get(key):
			conditions[field] = f[key]
	conditions.update(extra or {})
	or_filters = None
	if f.get("search"):
		like = f"%{f.search}%"
		or_filters = {"name": ("like", like), "asset_name": ("like", like), "asset_serial_no": ("like", like), "custodian": ("like", like)}
		# match employees by name too
		emps = frappe.get_all("Employee", filters={"employee_name": ("like", like)}, pluck="name")
		if emps:
			or_filters["custodian"] = ("in", emps)
	rows = frappe.get_list(ASSET, filters=conditions, or_filters=or_filters, fields=ASSET_FIELDS, order_by="asset_category asc, asset_name asc, name asc", limit_page_length=0)
	types = _category_types()
	names = _names({r.custodian for r in rows})
	since = _since([r.name for r in rows if r.custodian])
	subscription_types = _subscription_types()
	return [_row(r, types, names, since, subscription_types) for r in rows]


# ---------------------------------------------------------------- boot


@frappe.whitelist()
def boot():
	_read()
	user = frappe.db.get_value("User", frappe.session.user, ["first_name", "full_name", "user_image"], as_dict=True)
	categories = frappe.get_all(CATEGORY, fields=["name", "asset_category_type as category_type"], order_by="name")
	cat_names = [c.name for c in categories]
	subs = frappe.get_all("Item Group", filters={"parent_item_group": ("in", cat_names or [""])}, fields=["name", "parent_item_group as category"], order_by="name")
	return {
		"user": frappe.session.user,
		"first_name": user.first_name or frappe.session.user,
		"full_name": user.full_name or frappe.session.user,
		"user_image": user.user_image,
		"can_assign": bool(frappe.has_permission(MOVEMENT, "create")),
		"can_write": bool(frappe.has_permission(ASSET, "create")),
		"categories": categories,
		"sub_categories": subs,
		"category_types": _type_info(),
		"can_add_type": bool(frappe.has_permission(TYPE, "create")),
		"can_bulk_create": bool(frappe.has_permission(ASSET, "create")),
		"can_add_employee": bool(frappe.has_permission("Employee", "create")),
		"can_see_acks": bool(frappe.has_permission(ACK, "read")),
		"can_edit_fields": bool(frappe.has_permission("Item Group", "write")),
		"ack_enabled": _ack_enabled(),
		"require_rating": bool(cint(_setting("require_condition_rating", 1))),
		"expiry_alert_days": cint(_setting("expiry_alert_days", 45)),
		"default_location": _setting("default_location"),
		"can_manage_settings": bool(frappe.has_permission(SETTINGS, "write")),
		"company": _default_company(),
		"today": nowdate(),
	}


def _ack_enabled():
	from asset_management.asset_management.acknowledgement import enabled

	return enabled()


# ---------------------------------------------------------------- dashboard


@frappe.whitelist()
def dashboard():
	_read()
	assets = _assets()
	today = getdate(nowdate())
	soon = getdate(add_days(today, cint(_setting("expiry_alert_days", 45))))

	def monthly(a):
		cost = flt(a.purchase_cost)
		return cost / 12 if a.billing_cycle == "Yearly" else cost if a.billing_cycle == "Monthly" else 0

	by_status = {s: 0 for s in STATUSES}
	cats = {}
	for a in assets:
		by_status[a.status] = by_status.get(a.status, 0) + 1
		c = cats.setdefault(a.category, {"name": a.category, "type": a.category_type, "total": 0, "assigned": 0, "available": 0, "subs": {}})
		c["total"] += 1
		c["assigned"] += a.status == "Assigned"
		c["available"] += a.status == "Available"
		s = c["subs"].setdefault(a.sub_category, {"name": a.sub_category or "—", "total": 0, "assigned": 0})
		s["total"] += 1
		s["assigned"] += a.status == "Assigned"
	for c in cats.values():
		c["subs"] = sorted(c["subs"].values(), key=lambda s: -s["total"])

	live = [a for a in assets if a.status not in ("Disposed", "Draft")]
	expiring = sorted([a for a in live if a.expiry_date and getdate(a.expiry_date) <= soon], key=lambda a: getdate(a.expiry_date))

	# recent issues / returns from the standard Asset Movements
	recent = []
	moves = frappe.db.sql(
		"""select m.name, m.purpose, m.transaction_date, i.asset, i.from_employee, i.to_employee
		from `tabAsset Movement Item` i join `tabAsset Movement` m on m.name = i.parent
		where m.docstatus = 1 and (i.to_employee is not null and i.to_employee != '' or i.from_employee is not null and i.from_employee != '')
		order by m.transaction_date desc, m.creation desc limit 8""",
		as_dict=True,
	)
	names = _names({m.to_employee for m in moves} | {m.from_employee for m in moves})
	cat_of = dict(frappe.get_all(ASSET, filters={"name": ("in", [m.asset for m in moves] or [""])}, fields=["name", "asset_category"], as_list=True))
	for m in moves:
		issued = bool(m.to_employee)
		emp = m.to_employee or m.from_employee
		recent.append({"asset": m.asset, "status": "Assigned" if issued else "Returned", "employee": emp, "employee_name": names.get(emp),
			"category": cat_of.get(m.asset), "date": getdate(m.transaction_date), "movement": m.name})

	return {
		"first_name": frappe.db.get_value("User", frappe.session.user, "first_name") or frappe.session.user,
		"total": len(assets),
		"by_status": by_status,
		"holders": len({a.assigned_to for a in assets if a.assigned_to}),
		"employees": frappe.db.count("Employee", {"status": "Active"}),
		"subscription_monthly": sum(monthly(a) for a in live if a.is_subscription),
		"hardware_value": sum(flt(a.purchase_cost) for a in live if not a.is_subscription),
		"categories": sorted(cats.values(), key=lambda c: c["name"] or ""),
		"expiring": expiring[:10],
		"recent": recent,
	}


# ---------------------------------------------------------------- assets


@frappe.whitelist()
def assets(filters=None):
	_read()
	f = _args(filters)
	rows = _assets(f)
	counts = {}
	for r in rows:
		counts[r.status] = counts.get(r.status, 0) + 1
	if f.get("status"):
		rows = [r for r in rows if r.status == f.status]
	return {"rows": rows, "counts": counts}


@frappe.whitelist()
def asset(name):
	_read()
	doc = frappe.get_doc(ASSET, name)
	doc.check_permission("read")
	row = _row(doc, _category_types(), _names([doc.custodian]), _since([name]))
	lines = _movements([name])
	acks = _acks([name])
	periods = list(reversed(_periods(lines, acks)))
	timeline = list(reversed(_timeline(lines, acks)))
	names = _names({p["employee"] for p in periods} | {e["from_employee"] for e in timeline} | {e["to_employee"] for e in timeline})
	holder = None
	if doc.custodian:
		holder = frappe.db.get_value("Employee", doc.custodian, ["name", "employee_name", "department", "designation", "image"], as_dict=True)
	for p in periods:
		p["employee_name"] = names.get(p["employee"])
		p["from_employee_name"] = names.get(p["from_employee"])
		p["handed_to_name"] = names.get(p["handed_to"])
		p["department"] = frappe.db.get_value("Employee", p["employee"], "department")
		p["status"] = "Returned" if p["returned_on"] else "Assigned"
	for e in timeline:
		e["from_employee_name"] = names.get(e["from_employee"])
		e["to_employee_name"] = names.get(e["to_employee"])
	ack = None
	if row.acknowledgement_record:
		ack = frappe.db.get_value(
			ACK, row.acknowledgement_record,
			["name", "status", "email", "sent_count", "last_sent_on", "acknowledged_on", "acknowledged_ip", "employee_remarks"], as_dict=True,
		)
	return {
		"doc": row,
		"brand": frappe.db.get_value("Item", doc.item_code, "brand"),
		"holder": holder,
		"acknowledgement": ack,
		"specifications": [
			{"label": s.specification, "value": s.value, "mandatory": s.mandatory, "field_type": s.field_type}
			for s in doc.get("asset_specifications") or []
		],
		"history": periods,
		"timeline": timeline,
	}


# ---------------------------------------------------------------- assign / return (standard Asset Movement)


def _movement_time(date, late=False):
	"""A date and time as entered; a date alone: today -> now, another day -> a fixed time that day (returns later than issues)."""
	if date and len(str(date).strip()) > 10:
		return min(get_datetime(date), now_datetime())
	if not date or getdate(date) == getdate(nowdate()):
		return now_datetime()
	return get_datetime(f"{getdate(date)} {'17:00:00' if late else '10:00:00'}")


def _submit_movement(purpose, rows, when):
	"""One standard Asset Movement per company, submitted."""
	by_company = {}
	for r in rows:
		by_company.setdefault(r["company"], []).append(r)
	names = []
	for company, items in by_company.items():
		mv = frappe.get_doc({
			"doctype": MOVEMENT,
			"company": company,
			"purpose": purpose,
			"transaction_date": when,
			"assets": [{k: v for k, v in i.items() if k != "company"} | {"company": company} for i in items],
		})
		mv.insert()
		mv.submit()
		names.append(mv.name)
	return names


def _submitted(names):
	rows = frappe.get_all(ASSET, filters={"name": ("in", names)}, fields=["name", "docstatus", "status", "custodian", "company", "location", "asset_name"])
	found = {r.name for r in rows}
	missing = [n for n in names if n not in found]
	if missing:
		frappe.throw(_("Asset {0} not found.").format(", ".join(missing)))
	for r in rows:
		if r.docstatus != 1:
			frappe.throw(_("{0} is not submitted yet. Submit the Asset first.").format(r.name))
		if r.status in DISPOSED:
			frappe.throw(_("{0} is {1}.").format(r.name, r.status))
	return rows


SETTINGS = "Asset Management Settings"


def _setting(field, default=None):
	value = frappe.db.get_single_value(SETTINGS, field)
	return default if value in (None, "") else value


def _conditions(conditions, names, required=None):
	"""{asset: {rating (0..1, a Rating field), notes}}; a star rating at hand-over is required unless Settings say not."""
	if required is None:
		required = bool(cint(_setting("require_condition_rating", 1)))
	given = _args(conditions)
	out = {}
	for n in names:
		c = frappe._dict(given.get(n) or {})
		rating = flt(c.get("rating"))
		if rating > 1:  # stars given as 1..5
			rating = rating / 5
		if required and rating <= 0:
			frappe.throw(_("Rate the condition of {0} (1 to 5 stars) before handing it over.").format(n))
		out[n] = {"condition_rating": min(rating, 1) or None, "condition_notes": (c.get("notes") or "").strip() or None}
	return out


def _employee(employee):
	emp = frappe.db.get_value("Employee", employee, ["name", "employee_name", "status"], as_dict=True)
	if not emp:
		frappe.throw(_("Employee {0} not found.").format(employee))
	return emp


@frappe.whitelist()
def assign(assets, employee, assigned_on=None, conditions=None):
	"""Hand assets to an employee: a standard Asset Movement (Issue) with the condition at hand-over. Submitting
	it emails the employee an acknowledgement link (acknowledgement.py)."""
	frappe.has_permission(MOVEMENT, "create", throw=True)
	names = _list(assets)
	if not names:
		frappe.throw(_("Pick at least one asset."))
	emp = _employee(employee)
	rows = _submitted(names)
	for r in rows:
		if r.custodian:
			frappe.throw(_("{0} is already with {1}. Return it first.").format(r.name, frappe.db.get_value("Employee", r.custodian, "employee_name") or r.custodian))
	cond = _conditions(conditions, names)
	movements = _submit_movement(
		"Issue",
		[{"asset": r.name, "asset_name": r.asset_name, "to_employee": employee, "company": r.company, **cond[r.name]} for r in rows],
		_movement_time(assigned_on),
	)
	return {"movements": movements, "employee_name": emp.employee_name, "acknowledgements": _acks_of(movements)}


def _acks_of(movements):
	return frappe.get_all(ACK, filters={"asset_movement": ("in", movements or [""])}, fields=["name", "employee_name", "email", "status"])


@frappe.whitelist()
def transfer(assets, employee=None, location=None, transferred_on=None, conditions=None):
	"""Move assets to another employee and / or location, keeping the full history: standard Asset Movements.

	another employee and location  -> Transfer and Issue (from the current holder)
	another employee only          -> Issue from the current holder
	another location only          -> Transfer; the current holder (if any) keeps the asset
	A new holder gets the hand-over condition and an acknowledgement email, as on assign.
	"""
	frappe.has_permission(MOVEMENT, "create", throw=True)
	names = _list(assets)
	if not names:
		frappe.throw(_("Pick at least one asset."))
	if not employee and not location:
		frappe.throw(_("Choose the employee and / or the location to transfer to."))
	if employee:
		_employee(employee)
	if location and not frappe.db.exists("Location", location):
		frappe.throw(_("Location {0} not found.").format(location))
	rows = _submitted(names)
	new_holder = [r.name for r in rows if employee and employee != r.custodian]
	cond = _conditions(conditions, new_holder)
	by_purpose = {}
	for r in rows:
		to_emp = employee if employee and employee != r.custodian else None
		to_loc = location if location and location != r.location else None
		if not to_emp and not to_loc:
			frappe.throw(_("{0} is already with that employee at {1}.").format(r.name, r.location))
		line = {"asset": r.name, "asset_name": r.asset_name, "company": r.company}
		if to_emp and to_loc:
			purpose = "Transfer and Issue" if r.custodian else "Transfer"
			line.update(from_employee=r.custodian or None, to_employee=to_emp, source_location=r.location, target_location=to_loc, **cond[r.name])
		elif to_emp:
			purpose = "Issue"
			line.update(from_employee=r.custodian or None, to_employee=to_emp, **cond[r.name])
		else:
			# a location move: ERPNext takes the custodian from the latest movement, so the holder is carried over
			purpose = "Transfer"
			line.update(source_location=r.location, target_location=to_loc, from_employee=r.custodian or None, to_employee=r.custodian or None)
		by_purpose.setdefault(purpose, []).append(line)
	when = _movement_time(transferred_on)
	movements = []
	for purpose, lines in by_purpose.items():
		movements += _submit_movement(purpose, lines, when)
	return {"movements": movements, "acknowledgements": _acks_of(movements)}


@frappe.whitelist()
def unassign(assets, returned_on=None):
	frappe.has_permission(MOVEMENT, "create", throw=True)
	names = _list(assets)
	if not names:
		frappe.throw(_("Pick at least one asset."))
	rows = _submitted(names)
	for r in rows:
		if not r.custodian:
			frappe.throw(_("{0} is not assigned to anyone.").format(r.name))
	# a Receipt back at the asset's own location; with no To Employee, the Custodian is cleared
	movements = _submit_movement(
		"Receipt",
		[{"asset": r.name, "asset_name": r.asset_name, "from_employee": r.custodian, "target_location": r.location, "company": r.company} for r in rows],
		_movement_time(returned_on, late=True),
	)
	return {"movements": movements, "returned": names}


@frappe.whitelist()
def assign_board(filters=None):
	"""The Assign & Return page: submitted assets ready to hand out, and assets with employees."""
	_read()
	rows = _assets(filters)
	emps = {r.assigned_to for r in rows if r.assigned_to}
	dept = dict(frappe.get_all("Employee", filters={"name": ("in", list(emps) or [""])}, fields=["name", "department"], as_list=True))
	for r in rows:
		r.department = dept.get(r.assigned_to)
	return {
		"available": [r for r in rows if r.status == "Available"],
		"assigned": sorted([r for r in rows if r.status == "Assigned"], key=lambda r: (r.employee_name or "", r.name)),
		"drafts": sum(1 for r in rows if r.status == "Draft"),
	}


# ---------------------------------------------------------------- employees


@frappe.whitelist()
def employees(search=None, department=None):
	_read()
	filters = {"status": "Active"}
	if department:
		filters["department"] = department
	or_filters = None
	if search:
		like = f"%{search}%"
		or_filters = {"name": ("like", like), "employee_name": ("like", like), "designation": ("like", like)}
	rows = frappe.get_all(
		"Employee", filters=filters, or_filters=or_filters,
		fields=["name", "employee_name", "department", "designation", "image", "company_email"],
		order_by="employee_name asc", limit_page_length=0,
	)
	types = _category_types()
	subscription_types = _subscription_types()
	held = {}
	for a in frappe.get_all(ASSET, filters={"docstatus": 1, "custodian": ("is", "set")}, fields=["name", "custodian", "asset_category"], limit_page_length=0):
		held.setdefault(a.custodian, []).append(a)
	for r in rows:
		mine = held.get(r.name, [])
		r.assets = [a.name for a in mine]
		r.subscriptions = sum(1 for a in mine if types.get(a.asset_category) in subscription_types)
		r.hardware = len(mine) - r.subscriptions
	departments = sorted({d for d in frappe.get_all("Employee", filters={"status": "Active"}, pluck="department") if d})
	return {"rows": rows, "departments": departments}


EMPLOYEE_FIELDS = (
	"first_name", "last_name", "gender", "date_of_birth", "date_of_joining", "company", "department", "designation",
	"cell_number", "company_email", "personal_email", "status", "relieving_date",
)


def _employee_values(d):
	"""Cleaned Employee values from the workspace dialog; the email given becomes the preferred email (where
	hand-over acknowledgements are sent)."""
	from frappe.utils import validate_email_address

	first = (d.first_name or "").strip()
	if not first:
		frappe.throw(_("Enter the first name."))
	for field in ("company_email", "personal_email"):
		value = (d.get(field) or "").strip()
		if value and not validate_email_address(value):
			frappe.throw(_("{0} is not a valid email address.").format(value))
		d[field] = value or None
	mobile = (d.cell_number or "").replace(" ", "")
	if mobile and not (mobile.isdigit() and len(mobile) <= 10):
		frappe.throw(_("Mobile number must be digits only, at most 10 (got “{0}”).").format(d.cell_number))
	d.cell_number = mobile or None
	return {
		"first_name": first,
		"last_name": (d.last_name or "").strip() or None,
		"gender": d.gender,
		"date_of_birth": d.date_of_birth,
		"date_of_joining": d.date_of_joining or nowdate(),
		"company": d.company or _default_company(),
		"department": d.department or None,
		"designation": d.designation or None,
		"cell_number": d.cell_number or None,
		"company_email": d.company_email,
		"personal_email": d.personal_email,
		"prefered_contact_email": "Company Email" if d.company_email else "Personal Email" if d.personal_email else None,
	}


@frappe.whitelist(methods=["POST"])
def create_employee(data):
	"""A standard Employee from the workspace (Employees > New Employee)."""
	d = _args(data)
	frappe.has_permission("Employee", "create", throw=True)
	doc = frappe.get_doc({"doctype": "Employee", **_employee_values(d), "status": "Active"}).insert()
	return {"name": doc.name, "employee_name": doc.employee_name, "email": doc.get("prefered_email") or d.company_email or d.personal_email}


@frappe.whitelist(methods=["POST"])
def update_employee(name, data):
	"""Edit an Employee from the workspace (employee page > Edit). The standard Employee checks still apply."""
	d = _args(data)
	doc = frappe.get_doc("Employee", name)
	doc.check_permission("write")
	doc.update(_employee_values(d))
	if d.get("status"):
		doc.status = d.status
	# ERPNext needs a relieving date for an employee who has left
	doc.relieving_date = d.get("relieving_date") or (doc.relieving_date if doc.status == "Left" else None)
	doc.save()
	return {"name": doc.name, "employee_name": doc.employee_name, "email": doc.get("prefered_email")}


@frappe.whitelist()
def employee(name):
	_read()
	emp = frappe.db.get_value(
		"Employee", name, ["name", "employee_name", "image", "prefered_email", *EMPLOYEE_FIELDS], as_dict=True
	)
	if not emp:
		frappe.throw(_("Employee {0} not found.").format(name))
	emp.can_edit = bool(frappe.has_permission("Employee", "write", doc=name))
	current = _assets(extra={"custodian": name, "docstatus": 1})
	lines = _movements(employee=name)
	# full timelines of those assets, so a return by a later movement is seen
	assets_held = list({ln.asset for ln in lines})
	periods = [p for p in _periods(_movements(assets_held), _acks(assets_held)) if p["employee"] == name]
	cats = dict(frappe.get_all(ASSET, filters={"name": ("in", [p["asset"] for p in periods] or [""])}, fields=["name", "asset_category"], as_list=True))
	others = _names({p["from_employee"] for p in periods} | {p["handed_to"] for p in periods})
	for p in periods:
		p["category"] = cats.get(p["asset"])
		p["from_employee_name"] = others.get(p["from_employee"])
		p["handed_to_name"] = others.get(p["handed_to"])
		p["status"] = "Returned" if p["returned_on"] else "Assigned"
	return {"employee": emp, "current": current, "history": list(reversed(periods))}


# ---------------------------------------------------------------- catalogue: Asset Category > Item Group > Item


@frappe.whitelist()
def catalogue():
	_read()
	counts = {}
	for a in _assets():
		c = counts.setdefault(a.item, {"total": 0, "assigned": 0, "available": 0})
		c["total"] += 1
		c["assigned"] += a.status == "Assigned"
		c["available"] += a.status == "Available"
	cats = frappe.get_all(CATEGORY, fields=["name", "asset_category_type as category_type"], order_by="name")
	subs = frappe.get_all("Item Group", filters={"parent_item_group": ("in", [c.name for c in cats] or [""])}, fields=["name", "parent_item_group"], order_by="name")
	items = frappe.get_all("Item", filters={"is_fixed_asset": 1, "disabled": 0}, fields=["name", "item_name", "item_group", "asset_category", "brand", "description"], order_by="item_name")
	for i in items:
		i.update(counts.get(i.name, {"total": 0, "assigned": 0, "available": 0}))
	spec_counts = dict(frappe.db.sql(
		"""select parent, count(*) from `tabAsset Specification Field` where parenttype = 'Item Group' and parent in %s group by parent""",
		(tuple(s.name for s in subs) or ("",),),
	))
	for s in subs:
		s["items"] = [i for i in items if i.item_group == s.name]
		s["spec_fields"] = spec_counts.get(s.name, 0)
	for c in cats:
		c["subs"] = [s for s in subs if s.parent_item_group == c.name]
	used = {}
	for c in cats:
		used[c.category_type or "Hardware"] = used.get(c.category_type or "Hardware", 0) + 1
	types = [
		{"name": name, "is_subscription": t.is_subscription, "color": t.color, "categories": used.get(name, 0)}
		for name, t in sorted(_type_info().items())
	]
	return {"categories": cats, "types": types}


@frappe.whitelist()
def ensure_category_group(category):
	"""Sub-categories are Item Groups under a group named after the Asset Category; make that group if needed."""
	if not frappe.db.exists(CATEGORY, category):
		frappe.throw(_("Asset Category {0} not found.").format(category))
	if not frappe.db.exists("Item Group", category):
		frappe.get_doc({"doctype": "Item Group", "item_group_name": category, "parent_item_group": "All Item Groups", "is_group": 1}).insert()
	elif not frappe.db.get_value("Item Group", category, "is_group"):
		frappe.throw(_("Item Group {0} exists but is not a group.").format(category))
	return category


# ---------------------------------------------------------------- quick create from the workspace (standard records)


def _default_company():
	return frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company") or frappe.get_all(
		"Company", pluck="name", limit=1
	)[0]


def _category_accounts(company, category_type, fixed_asset_account=None, required=True):
	"""The accounts row for a new Asset Category: copied from a category of the same type (else any), with the
	company's depreciation accounts as fallback, so it can be created without opening the full form."""
	like = frappe.db.sql(
		"""select a.fixed_asset_account, a.accumulated_depreciation_account, a.depreciation_expense_account
		from `tabAsset Category Account` a join `tabAsset Category` c on c.name = a.parent
		where a.company_name = %s order by (c.asset_category_type = %s) desc, c.creation asc limit 1""",
		(company, category_type),
		as_dict=True,
	)
	row = like[0] if like else frappe._dict()
	company_doc = frappe.db.get_value(
		"Company", company, ["accumulated_depreciation_account", "depreciation_expense_account"], as_dict=True
	)
	fixed = fixed_asset_account or row.fixed_asset_account or frappe.db.get_value(
		"Account", {"company": company, "account_type": "Fixed Asset", "is_group": 0, "disabled": 0}, "name"
	)
	if not fixed and required:
		frappe.throw(_("Choose the Fixed Asset Account for {0}.").format(company))
	return {
		"company_name": company,
		"fixed_asset_account": fixed,
		"accumulated_depreciation_account": row.accumulated_depreciation_account or company_doc.accumulated_depreciation_account,
		"depreciation_expense_account": row.depreciation_expense_account or company_doc.depreciation_expense_account,
	}


@frappe.whitelist()
def category_defaults(category_type="Hardware"):
	"""Prefill for the New Asset Category dialog."""
	frappe.has_permission(CATEGORY, "create", throw=True)
	company = _default_company()
	return {"company": company, "fixed_asset_account": _category_accounts(company, category_type, required=False)["fixed_asset_account"]}


@frappe.whitelist(methods=["POST"])
def create_category(data):
	"""A standard Asset Category (with its accounts row) plus the Item Group its sub-categories sit under."""
	d = _args(data)
	frappe.has_permission(CATEGORY, "create", throw=True)
	name = (d.category_name or "").strip()
	if not name:
		frappe.throw(_("Enter the category name."))
	if frappe.db.exists(CATEGORY, name):
		frappe.throw(_("Asset Category {0} already exists.").format(name))
	category_type = d.category_type or "Hardware"
	if not frappe.db.exists(TYPE, category_type):
		frappe.throw(_("Category Type {0} not found.").format(category_type))
	company = d.company or _default_company()
	doc = frappe.get_doc({
		"doctype": CATEGORY,
		"asset_category_name": name,
		"asset_category_type": category_type,
		# subscriptions are not depreciated; physical assets follow the standard depreciation settings
		"non_depreciable_category": 1 if category_type in _subscription_types() else 0,
		"accounts": [_category_accounts(company, category_type, d.fixed_asset_account)],
	}).insert()
	ensure_category_group(doc.name)
	return doc.name


@frappe.whitelist(methods=["POST"])
def create_sub_category(category, sub_category):
	"""A standard Item Group under the category's group."""
	frappe.has_permission("Item Group", "create", throw=True)
	name = (sub_category or "").strip()
	if not name:
		frappe.throw(_("Enter the sub-category name."))
	if frappe.db.exists("Item Group", name):
		frappe.throw(_("Item Group {0} already exists. Sub-category names must be unique across all Item Groups.").format(name))
	ensure_category_group(category)
	return frappe.get_doc({"doctype": "Item Group", "item_group_name": name, "parent_item_group": category, "is_group": 0}).insert().name


@frappe.whitelist(methods=["POST"])
def create_item(data):
	"""A standard Item set up as a non-stock Fixed Asset item of the category, in the sub-category's Item Group."""
	d = _args(data)
	frappe.has_permission("Item", "create", throw=True)
	item_name = (d.item_name or "").strip()
	item_code = (d.item_code or "").strip() or item_name
	if not item_name:
		frappe.throw(_("Enter the item name."))
	if frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} already exists.").format(item_code))
	if frappe.db.get_value("Item Group", d.sub_category, "parent_item_group") != d.category:
		frappe.throw(_("{0} is not a sub-category of {1}.").format(d.sub_category, d.category))
	if d.brand and not frappe.db.exists("Brand", d.brand):
		frappe.get_doc({"doctype": "Brand", "brand": d.brand}).insert()
	return frappe.get_doc({
		"doctype": "Item",
		"item_code": item_code,
		"item_name": item_name,
		"item_group": d.sub_category,
		"brand": d.brand or None,
		"description": d.description or item_name,
		"stock_uom": "Nos",
		"is_stock_item": 0,
		"is_fixed_asset": 1,
		"asset_category": d.category,
	}).insert().name


def _serials(value):
	"""Serial numbers typed one per line (or separated by commas / tabs, as pasted from a sheet)."""
	text = value if isinstance(value, str) else "\n".join(value or [])
	return [s.strip() for s in text.replace(",", "\n").replace("\t", "\n").replace(";", "\n").split("\n") if s.strip()]


@frappe.whitelist(methods=["POST"])
def bulk_create_assets(data):
	"""Many assets of one model / configuration that differ only by serial number: one standard Asset per serial
	(an "Existing Asset", like the rest of the register), with the same purchase details and specifications."""
	from asset_management.asset_management.specifications import check_units, sync_rows

	d = _args(data)
	frappe.has_permission(ASSET, "create", throw=True)
	if cint(d.submit):
		frappe.has_permission(ASSET, "submit", throw=True)
	item = frappe.db.get_value("Item", d.item_code, ["name", "item_name", "item_group", "is_fixed_asset", "asset_category", "disabled"], as_dict=True)
	if not item or not item.is_fixed_asset or item.disabled:
		frappe.throw(_("{0} is not an enabled Fixed Asset item.").format(d.item_code))
	# units with their own values (sub-categories with Per Unit fields), or just serial numbers
	units = check_units(_list(d.units), item.item_group) if d.units else None
	serials = [u.serial_no for u in units] if units else _serials(d.serial_numbers)
	unit_specs = {u.serial_no: u.specifications for u in units} if units else {}
	if not serials:
		frappe.throw(_("Enter at least one serial number."))
	if len(serials) > 500:
		frappe.throw(_("{0} serial numbers given; create at most 500 at a time.").format(len(serials)))
	seen, dupes = set(), []
	for s in serials:
		if s.lower() in seen:
			dupes.append(s)
		seen.add(s.lower())
	if dupes:
		frappe.throw(_("These serial numbers are listed twice: {0}").format(", ".join(sorted(set(dupes)))))
	taken = frappe.get_all(ASSET, filters={"asset_serial_no": ("in", serials), "docstatus": ("<", 2)}, fields=["name", "asset_serial_no"])
	if taken:
		frappe.throw(_("Already used by another asset: {0}").format(", ".join(f"{t.asset_serial_no} ({t.name})" for t in taken)))
	if not d.location:
		frappe.throw(_("Choose the location."))
	if not d.purchase_date:
		frappe.throw(_("Enter the purchase date."))
	specs = _args(d.specifications)
	names = []
	for serial in serials:
		doc = frappe.get_doc({
			"doctype": ASSET,
			# Settings > Asset Naming default (the form default may be cached in this process)
			"naming_series": d.naming_series or _setting("default_naming_series"),
			"item_code": item.name,
			"item_name": item.item_name,
			"asset_name": item.item_name,
			"asset_category": item.asset_category,
			"asset_type": "Existing Asset",
			"company": d.company or _default_company(),
			"location": d.location,
			"purchase_date": d.purchase_date,
			"available_for_use_date": d.available_for_use_date or d.purchase_date,
			"net_purchase_amount": flt(d.net_purchase_amount),
			"calculate_depreciation": 0,
			"asset_serial_no": serial,
			"warranty_renewal_date": d.warranty_renewal_date or None,
			"billing_cycle": d.billing_cycle or None,
		})
		sync_rows(doc, values={**specs, **unit_specs.get(serial, {})})
		doc.insert()
		if cint(d.submit):
			doc.submit()
		names.append(doc.name)
	return {"assets": names, "submitted": bool(cint(d.submit))}


@frappe.whitelist()
def acknowledgements(status=None, search=None):
	"""Hand-over acknowledgements for the workspace: Pending ones can be resent, Completed ones carry the proof."""
	frappe.has_permission(ACK, "read", throw=True)
	filters = {}
	if search:
		like = f"%{search}%"
		# the record, the employee or the movement, or any of its assets / serial numbers
		matched = set(frappe.get_list(ACK, or_filters={"name": ("like", like), "employee": ("like", like),
			"employee_name": ("like", like), "asset_movement": ("like", like)}, pluck="name", limit_page_length=0))
		matched |= set(frappe.get_all(f"{ACK} Item", or_filters={"asset": ("like", like), "serial_no": ("like", like)}, pluck="parent"))
		filters["name"] = ("in", list(matched) or [""])
	rows = frappe.get_list(
		ACK, filters=filters,
		fields=["name", "status", "employee", "employee_name", "email", "asset_movement", "movement_purpose", "assigned_on",
			"sent_on", "last_sent_on", "sent_count", "acknowledged_on", "acknowledged_ip", "employee_remarks"],
		order_by="assigned_on desc, creation desc", limit_page_length=500,
	)
	counts = {}
	for r in rows:
		counts[r.status] = counts.get(r.status, 0) + 1
	items = {}
	for i in frappe.get_all(f"{ACK} Item", filters={"parent": ("in", [r.name for r in rows] or [""])},
			fields=["parent", "asset", "serial_no", "condition_rating"], order_by="idx asc"):
		items.setdefault(i.parent, []).append(i)
	for r in rows:
		r["assets"] = items.get(r.name, [])
	if status:
		rows = [r for r in rows if r.status == status]
	return {"rows": rows, "counts": counts, "can_resend": bool(frappe.has_permission(ACK, "write"))}


@frappe.whitelist(methods=["POST"])
def resend_acknowledgement(name):
	from asset_management.asset_management.acknowledgement import resend

	return resend(name)


@frappe.whitelist()
def acknowledgement_link(name):
	from asset_management.asset_management.acknowledgement import get_link

	return get_link(name)


# ---------------------------------------------------------------- settings page

SETTING_FIELDS = (
	"send_acknowledgement", "it_team_emails", "acknowledgement_message", "require_condition_rating", "expiry_alert_days",
	"default_location", "naming_series_options", "default_naming_series",
)


@frappe.whitelist()
def settings_page():
	"""Everything the Settings tab shows: the settings, asset naming with counters, specification fields per
	sub-category, category types and locations."""
	from asset_management.asset_management.naming import counters

	frappe.has_permission(SETTINGS, "read", throw=True)
	doc = frappe.get_single(SETTINGS)
	cats = frappe.get_all(CATEGORY, fields=["name", "asset_category_type"], order_by="name")
	subs = frappe.get_all("Item Group", filters={"parent_item_group": ("in", [c.name for c in cats] or [""])},
		fields=["name", "parent_item_group as category"], order_by="parent_item_group, name")
	fields = {}
	for f in frappe.get_all("Asset Specification Field", filters={"parenttype": "Item Group", "parent": ("in", [s.name for s in subs] or [""])},
			fields=["parent", "field_label", "field_type", "mandatory", "per_unit"], order_by="idx"):
		fields.setdefault(f.parent, []).append(f)
	asset_counts = dict(frappe.db.sql("select asset_sub_category, count(*) from tabAsset where docstatus < 2 group by asset_sub_category"))
	for s in subs:
		s["fields"] = fields.get(s.name, [])
		s["assets"] = asset_counts.get(s.name, 0)
	used = {}
	for c in cats:
		used[c.asset_category_type or "Hardware"] = used.get(c.asset_category_type or "Hardware", 0) + 1
	location_counts = dict(frappe.db.sql("select location, count(*) from tabAsset where docstatus < 2 group by location"))
	return {
		"settings": {f: doc.get(f) for f in SETTING_FIELDS},
		"series": counters(),
		"sub_categories": subs,
		"types": [{"name": n, "is_subscription": t.is_subscription, "color": t.color, "categories": used.get(n, 0)} for n, t in sorted(_type_info().items())],
		"locations": [{"name": n, "assets": location_counts.get(n, 0)} for n in frappe.get_all("Location", pluck="name", order_by="name")],
		"can_write": bool(frappe.has_permission(SETTINGS, "write")),
		"email_account": frappe.db.get_value("Email Account", {"default_outgoing": 1, "enable_outgoing": 1}, "email_id"),
	}


@frappe.whitelist(methods=["POST"])
def save_settings(data):
	d = _args(data)
	doc = frappe.get_single(SETTINGS)
	doc.check_permission("write")
	for f in SETTING_FIELDS:
		if f in d:
			doc.set(f, d[f])
	doc.save()
	return settings_page()


@frappe.whitelist(methods=["POST"])
def set_series_counter(prefix, current):
	from asset_management.asset_management.naming import set_counter

	frappe.has_permission(SETTINGS, "write", throw=True)
	set_counter(prefix, current)
	return settings_page()


@frappe.whitelist(methods=["POST"])
def create_location(location_name):
	frappe.has_permission("Location", "create", throw=True)
	name = (location_name or "").strip()
	if not name:
		frappe.throw(_("Enter the location name."))
	if frappe.db.exists("Location", name):
		frappe.throw(_("Location {0} already exists.").format(name))
	return frappe.get_doc({"doctype": "Location", "location_name": name}).insert().name


@frappe.whitelist()
def link_search(doctype, txt="", filters=None):
	_read()
	f = _args(filters)
	if doctype == "Employee":
		rows = frappe.get_all(
			"Employee", filters={"status": "Active"},
			or_filters={"name": ("like", f"%{txt}%"), "employee_name": ("like", f"%{txt}%")},
			fields=["name", "employee_name"], limit_page_length=20, order_by="employee_name asc",
		)
		return [{"value": r.name, "label": r.employee_name} for r in rows]
	if doctype == ASSET:
		conditions = {"docstatus": 1}
		if f.get("available"):
			conditions["custodian"] = ("is", "not set")
			conditions["status"] = ("not in", [*DISPOSED, *REPAIR])
		rows = frappe.get_list(
			ASSET, filters=conditions,
			or_filters={"name": ("like", f"%{txt}%"), "asset_name": ("like", f"%{txt}%"), "asset_serial_no": ("like", f"%{txt}%")},
			fields=["name", "asset_category"], limit_page_length=20, order_by="name asc",
		)
		return [{"value": r.name, "label": r.asset_category} for r in rows]
	frappe.throw(_("Not allowed."))
