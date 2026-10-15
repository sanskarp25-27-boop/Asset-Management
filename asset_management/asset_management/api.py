"""Server side of the Asset Workspace (page "asset-workspace"): a simple view over ERPNext's standard Assets module.

Nothing here is a separate register. Assets are standard Assets (created and submitted on the Asset form), and
assigning / returning creates and submits a standard Asset Movement (Issue / Receipt), which is what sets the
Asset's Custodian. Hierarchy: Asset Category > Item Group (sub-category) > Item > Asset; see setup.py.
"""

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_datetime, getdate, now_datetime, nowdate

ASSET = "Asset"
MOVEMENT = "Asset Movement"
CATEGORY = "Asset Category"

ASSET_FIELDS = [
	"name", "asset_name", "item_code", "asset_category", "asset_sub_category", "asset_serial_no", "status", "docstatus",
	"custodian", "company", "location", "purchase_date", "net_purchase_amount", "billing_cycle", "warranty_renewal_date",
]
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
	return dict(frappe.get_all(CATEGORY, fields=["name", "asset_category_type"], as_list=True))


def _names(employees):
	employees = [e for e in employees if e]
	if not employees:
		return {}
	return dict(frappe.get_all("Employee", filters={"name": ("in", employees)}, fields=["name", "employee_name"], as_list=True))


def _row(a, types, names, since=None):
	"""A standard Asset in the shape the page uses."""
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
		category_type=types.get(a.asset_category) or "Hardware",
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
	return frappe.db.sql(
		f"""select m.name as movement, m.purpose, m.transaction_date, i.asset, i.from_employee, i.to_employee,
			i.target_location
		from `tabAsset Movement Item` i join `tabAsset Movement` m on m.name = i.parent
		where {" and ".join(conditions)}
		order by m.transaction_date asc, m.creation asc""",
		values,
		as_dict=True,
	)


def _periods(lines):
	"""Custody periods from movement lines: who held each asset, from when, until when (None = still holds it)."""
	# after each movement the custodian is that line's To Employee (none = back in stock)
	open_, out = {}, []
	for ln in lines:
		current = open_.get(ln.asset)
		if current and current["employee"] == ln.to_employee:
			continue  # e.g. a location transfer while the same employee holds it
		if current:
			current["returned_on"] = ln.transaction_date
			current["returned_by"] = ln.movement
			del open_[ln.asset]
		if ln.to_employee:
			period = {"asset": ln.asset, "employee": ln.to_employee, "assigned_on": ln.transaction_date, "movement": ln.movement, "returned_on": None}
			open_[ln.asset] = period
			out.append(period)
	return out


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
	return [_row(r, types, names, since) for r in rows]


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
		"today": nowdate(),
	}


# ---------------------------------------------------------------- dashboard


@frappe.whitelist()
def dashboard():
	_read()
	assets = _assets()
	today = getdate(nowdate())
	soon = getdate(add_days(today, 45))

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
		"subscription_monthly": sum(monthly(a) for a in live if a.category_type == "Subscription"),
		"hardware_value": sum(flt(a.purchase_cost) for a in live if a.category_type != "Subscription"),
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
	periods = list(reversed(_periods(_movements([name]))))
	names = _names({p["employee"] for p in periods})
	holder = None
	if doc.custodian:
		holder = frappe.db.get_value("Employee", doc.custodian, ["name", "employee_name", "department", "designation", "image"], as_dict=True)
	for p in periods:
		p["employee_name"] = names.get(p["employee"])
		p["department"] = frappe.db.get_value("Employee", p["employee"], "department")
		p["status"] = "Returned" if p["returned_on"] else "Assigned"
	return {
		"doc": row,
		"brand": frappe.db.get_value("Item", doc.item_code, "brand"),
		"holder": holder,
		"history": periods,
	}


# ---------------------------------------------------------------- assign / return (standard Asset Movement)


def _movement_time(date, late=False):
	"""Today -> now; another day -> a fixed time that day (returns later than issues)."""
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


@frappe.whitelist()
def assign(assets, employee, assigned_on=None):
	frappe.has_permission(MOVEMENT, "create", throw=True)
	names = _list(assets)
	if not names:
		frappe.throw(_("Pick at least one asset."))
	emp = frappe.db.get_value("Employee", employee, ["name", "employee_name"], as_dict=True)
	if not emp:
		frappe.throw(_("Employee {0} not found.").format(employee))
	rows = _submitted(names)
	for r in rows:
		if r.custodian:
			frappe.throw(_("{0} is already with {1}. Return it first.").format(r.name, frappe.db.get_value("Employee", r.custodian, "employee_name") or r.custodian))
	movements = _submit_movement(
		"Issue",
		[{"asset": r.name, "asset_name": r.asset_name, "to_employee": employee, "company": r.company} for r in rows],
		_movement_time(assigned_on),
	)
	return {"movements": movements, "employee_name": emp.employee_name}


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
	held = {}
	for a in frappe.get_all(ASSET, filters={"docstatus": 1, "custodian": ("is", "set")}, fields=["name", "custodian", "asset_category"], limit_page_length=0):
		held.setdefault(a.custodian, []).append(a)
	for r in rows:
		mine = held.get(r.name, [])
		r.assets = [a.name for a in mine]
		r.subscriptions = sum(1 for a in mine if types.get(a.asset_category) == "Subscription")
		r.hardware = len(mine) - r.subscriptions
	departments = sorted({d for d in frappe.get_all("Employee", filters={"status": "Active"}, pluck="department") if d})
	return {"rows": rows, "departments": departments}


@frappe.whitelist()
def employee(name):
	_read()
	emp = frappe.db.get_value(
		"Employee", name, ["name", "employee_name", "department", "designation", "image", "company_email", "status"], as_dict=True
	)
	if not emp:
		frappe.throw(_("Employee {0} not found.").format(name))
	current = _assets(extra={"custodian": name, "docstatus": 1})
	lines = _movements(employee=name)
	# full timelines of those assets, so a return by a later movement is seen
	periods = [p for p in _periods(_movements(list({ln.asset for ln in lines}))) if p["employee"] == name]
	cats = dict(frappe.get_all(ASSET, filters={"name": ("in", [p["asset"] for p in periods] or [""])}, fields=["name", "asset_category"], as_list=True))
	for p in periods:
		p["category"] = cats.get(p["asset"])
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
	for s in subs:
		s["items"] = [i for i in items if i.item_group == s.name]
	for c in cats:
		c["subs"] = [s for s in subs if s.parent_item_group == c.name]
	return cats


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
