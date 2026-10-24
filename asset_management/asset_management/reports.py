"""Reports for the Asset Workspace (Reports tab), computed from ERPNext's standard Assets, Employees and Asset Movements.

Cost basis:
	Hardware      one-time value = the Asset's Net Purchase Amount; spread over HW_LIFE_MONTHS for a monthly figure.
	Subscription  the Asset's cost per Billing Cycle (Monthly / Yearly), shown per month and per year.
	Monthly cost  = subscriptions per month + hardware value / HW_LIFE_MONTHS.
Every report returns {columns, rows, summary, chart}; the page renders, sorts, totals and exports them generically.
"""

import json

import frappe
from frappe import _
from frappe.utils import add_months, date_diff, flt, getdate, nowdate

from asset_management.asset_management import api

HW_LIFE_MONTHS = 36
DAYS_PER_MONTH = 30.4375
NO_DEPT = "No department"

REPORTS = {
	"employee_cost": ("Cost per employee", "What each employee's assets cost: hardware they hold, subscriptions per month and year, and subscription spend to date.", ["category", "department", "holding"]),
	"department_cost": ("Cost per department", "Asset cost rolled up by department, with the cost per employee.", ["category"]),
	"category_cost": ("Category & sub-category", "Value, monthly cost, utilisation and idle cost for every Category › Sub-category.", ["category"]),
	"item_utilisation": ("Item utilisation", "Units of each item, how many are in use, and what the idle units are worth.", ["category"]),
	"subscription_seats": ("Subscription seats", "Seats per subscription: used, free, monthly cost and the cost of unused seats.", []),
	"idle_assets": ("Idle assets", "Assets nobody holds (available or under repair), how long they have been idle and their value.", ["category"]),
	"renewals": ("Renewals & warranties", "Subscription renewals and hardware warranties due, with the renewal cost by month.", ["category", "months"]),
	"custody_log": ("Assignment history", "Every period an employee held an asset (from the standard Asset Movements), with days held.", ["category", "department", "dates"]),
	"asset_ageing": ("Asset ageing", "Assets by age since purchase, with value and how many are past warranty.", ["category"]),
	"leavers": ("Leavers holding assets", "Assets still with employees who are no longer Active: what to recover.", ["category"]),
	"employee_register": ("Employee asset register", "Every asset currently with an employee, one line each.", ["category", "department"]),
}


def _args(value):
	if isinstance(value, str):
		value = json.loads(value or "{}")
	return frappe._dict(value or {})


def monthly(a):
	"""Monthly cost of one asset."""
	cost = flt(a.purchase_cost)
	if a.is_subscription:
		return cost / 12 if a.billing_cycle == "Yearly" else cost
	return cost / HW_LIFE_MONTHS


def sub_monthly(a):
	return monthly(a) if a.is_subscription else 0


def hw_value(a):
	return flt(a.purchase_cost) if not a.is_subscription else 0


def col(key, label, type="text", total=False, **kw):
	return {"key": key, "label": label, "type": type, "total": total, **kw}


def _employees():
	rows = frappe.get_all("Employee", fields=["name", "employee_name", "department", "designation", "status", "relieving_date", "image"])
	for r in rows:
		r.department = r.department or NO_DEPT
	return {r.name: r for r in rows}


def _assets(f):
	"""Live assets (submitted, not disposed) for the category filter."""
	return [a for a in api._assets({"category": f.get("category")}) if a.status not in ("Draft", "Disposed")]


def _held_by(assets, emps, f):
	"""Assets currently with an employee, honouring the department filter."""
	out = []
	for a in assets:
		if not a.assigned_to:
			continue
		e = emps.get(a.assigned_to)
		if f.get("department") and (not e or e.department != f.department):
			continue
		out.append(a)
	return out


def _periods(assets):
	"""Custody periods (standard Asset Movements) of these assets."""
	by_name = {a.name: a for a in assets}
	periods = api._periods(api._movements(list(by_name)))
	today = getdate(nowdate())
	for p in periods:
		p["asset_row"] = by_name[p["asset"]]
		start = getdate(p["assigned_on"])
		end = getdate(p["returned_on"]) if p["returned_on"] else today
		p["days"] = max(date_diff(end, start), 0)
	return periods


def _spend(period):
	"""Subscription cost incurred while the employee held it."""
	return sub_monthly(period["asset_row"]) * period["days"] / DAYS_PER_MONTH


@frappe.whitelist()
def report(key, filters=None):
	api._read()
	if key not in REPORTS:
		frappe.throw(_("Unknown report."))
	f = _args(filters)
	title, description, filter_keys = REPORTS[key]
	out = globals()[f"_r_{key}"](f)
	out.update({
		"key": key,
		"title": title,
		"description": description,
		"filters": filter_keys,
		"departments": sorted({e.department for e in _employees().values()}),
		"hw_life_months": HW_LIFE_MONTHS,
	})
	return out


@frappe.whitelist()
def report_list():
	api._read()
	return [{"key": k, "title": v[0], "description": v[1]} for k, v in REPORTS.items()]


def money_tile(label, value, tone=""):
	return {"label": label, "value": value, "type": "money", "tone": tone}


def tile(label, value, type="int", tone=""):
	return {"label": label, "value": value, "type": type, "tone": tone}


def chart(title, rows, label_key, value_key, type="money", limit=12):
	top = sorted([r for r in rows if flt(r.get(value_key))], key=lambda r: -flt(r.get(value_key)))[:limit]
	return {"title": title, "type": type, "rows": [{"label": r.get(label_key), "sub": r.get(f"{label_key}_sub"), "value": flt(r.get(value_key))} for r in top]}


# ---------------------------------------------------------------- people


def _employee_rows(f, assets, emps):
	held = _held_by(assets, emps, f)
	spend = {}
	for p in _periods([a for a in assets if a.is_subscription]):
		spend[p["employee"]] = spend.get(p["employee"], 0) + _spend(p)
	rows = {}
	for e in emps.values():
		if e.status != "Active" and not any(a.assigned_to == e.name for a in held):
			continue
		if f.get("department") and e.department != f.department:
			continue
		rows[e.name] = frappe._dict(
			employee=e.employee_name, employee_sub=f"{e.name}{' · ' + e.designation if e.designation else ''}", department=e.department,
			status=e.status, hardware=0, hardware_value=0.0, subscriptions=0, subs_month=0.0, subs_year=0.0, monthly=0.0, annual=0.0,
			spend=spend.get(e.name, 0.0), _go=f"employee|{e.name}", _id=e.name,
		)
	for a in held:
		r = rows.get(a.assigned_to)
		if not r:
			continue
		if a.is_subscription:
			r.subscriptions += 1
			r.subs_month += sub_monthly(a)
		else:
			r.hardware += 1
			r.hardware_value += hw_value(a)
		r.monthly += monthly(a)
	for r in rows.values():
		r.subs_year = r.subs_month * 12
		r.annual = r.monthly * 12
	return list(rows.values())


def _r_employee_cost(f):
	emps = _employees()
	rows = _employee_rows(f, _assets(f), emps)
	if f.get("holding", "yes") == "yes":
		rows = [r for r in rows if r.hardware or r.subscriptions]
	rows.sort(key=lambda r: -r.monthly)
	total = sum(r.monthly for r in rows) or 1
	for r in rows:
		r.share = r.monthly / total * 100
	holders = [r for r in rows if r.hardware or r.subscriptions]
	top = max(rows, key=lambda r: r.monthly) if rows else None
	return {
		"columns": [
			col("employee", "Employee", "text", sub=True), col("department", "Department", "dept"),
			col("hardware", "Hardware", "int", True), col("hardware_value", "Hardware value", "money", True),
			col("subscriptions", "Subscriptions", "int", True), col("subs_month", "Subscriptions / month", "money", True),
			col("subs_year", "Subscriptions / year", "money", True), col("monthly", "Monthly cost", "money", True, strong=True),
			col("annual", "Annual cost", "money", True), col("spend", "Subscription spend to date", "money", True),
			col("share", "Share of cost", "bar"),
		],
		"rows": rows,
		"summary": [
			tile("Employees holding assets", len(holders)),
			money_tile("Total monthly cost", sum(r.monthly for r in rows), "lime"),
			money_tile("Avg per employee / month", sum(r.monthly for r in holders) / (len(holders) or 1)),
			money_tile("Hardware value held", sum(r.hardware_value for r in rows)),
			money_tile("Subscriptions / year", sum(r.subs_year for r in rows), "lav"),
			{"label": "Highest cost", "value": f"{top.employee}" if top else "—", "type": "text", "tone": "orange"},
		],
		"chart": chart("Monthly cost by employee", rows, "employee", "monthly"),
	}


def _r_department_cost(f):
	emps = _employees()
	people = _employee_rows(f, _assets(f), emps)
	depts = {}
	for e in emps.values():
		if e.status == "Active":
			d = depts.setdefault(e.department, frappe._dict(department=e.department, employees=0, holding=0, hardware=0, hardware_value=0.0,
				subscriptions=0, subs_month=0.0, monthly=0.0, annual=0.0, spend=0.0))
			d.employees += 1
	for r in people:
		d = depts.setdefault(r.department, frappe._dict(department=r.department, employees=0, holding=0, hardware=0, hardware_value=0.0,
			subscriptions=0, subs_month=0.0, monthly=0.0, annual=0.0, spend=0.0))
		d.holding += 1 if (r.hardware or r.subscriptions) else 0
		for k in ("hardware", "hardware_value", "subscriptions", "subs_month", "monthly", "annual", "spend"):
			d[k] += r[k]
	rows = sorted(depts.values(), key=lambda d: -d.monthly)
	total = sum(d.monthly for d in rows) or 1
	for d in rows:
		d.per_employee = d.monthly / (d.employees or 1)
		d.share = d.monthly / total * 100
	return {
		"columns": [
			col("department", "Department", "dept"), col("employees", "Active employees", "int", True), col("holding", "Holding assets", "int", True),
			col("hardware", "Hardware", "int", True), col("hardware_value", "Hardware value", "money", True),
			col("subscriptions", "Subscriptions", "int", True), col("subs_month", "Subscriptions / month", "money", True),
			col("monthly", "Monthly cost", "money", True, strong=True), col("annual", "Annual cost", "money", True),
			col("per_employee", "Cost / employee / month", "money"), col("spend", "Subscription spend to date", "money", True),
			col("share", "Share of cost", "bar"),
		],
		"rows": rows,
		"summary": [
			tile("Departments", len([d for d in rows if d.monthly])),
			money_tile("Total monthly cost", sum(d.monthly for d in rows), "lime"),
			money_tile("Total annual cost", sum(d.annual for d in rows)),
			money_tile("Hardware value held", sum(d.hardware_value for d in rows)),
			money_tile("Subscriptions / month", sum(d.subs_month for d in rows), "lav"),
			{"label": "Costliest department", "value": api_dept(rows[0].department) if rows and rows[0].monthly else "—", "type": "text", "tone": "orange"},
		],
		"chart": chart("Monthly cost by department", [dict(d, department=api_dept(d.department)) for d in rows], "department", "monthly"),
	}


def api_dept(d):
	"""'Research & Development - IL' -> 'Research & Development'."""
	parts = (d or "").rsplit(" - ", 1)
	return parts[0] if len(parts) == 2 and parts[1].isupper() and len(parts[1]) <= 6 else (d or "")


# ---------------------------------------------------------------- catalogue


def _r_category_cost(f):
	groups = {}
	for a in _assets(f):
		g = groups.setdefault((a.category, a.sub_category), frappe._dict(category=a.category, sub_category=a.sub_category or "—", type=a.category_type,
			assets=0, assigned=0, available=0, value=0.0, subs_month=0.0, idle_value=0.0, idle_month=0.0))
		g.assets += 1
		g.value += hw_value(a)
		g.subs_month += sub_monthly(a)
		if a.status == "Assigned":
			g.assigned += 1
		else:
			g.available += 1
			g.idle_value += hw_value(a)
			g.idle_month += sub_monthly(a)
	rows = sorted(groups.values(), key=lambda g: (g.category or "", g.sub_category))
	for g in rows:
		g.utilisation = g.assigned / g.assets * 100 if g.assets else 0
	n = sum(g.assets for g in rows) or 1
	return {
		"columns": [
			col("category", "Category"), col("sub_category", "Sub-category"), col("type", "Type", "status"),
			col("assets", "Assets", "int", True), col("assigned", "Assigned", "int", True), col("available", "Not assigned", "int", True),
			col("utilisation", "Utilisation", "bar"), col("value", "Hardware value", "money", True),
			col("subs_month", "Subscriptions / month", "money", True), col("idle_value", "Idle hardware value", "money", True),
			col("idle_month", "Idle subscriptions / month", "money", True),
		],
		"rows": rows,
		"summary": [
			tile("Assets", sum(g.assets for g in rows)),
			tile("Utilisation", sum(g.assigned for g in rows) / n * 100, "pct", "lime"),
			money_tile("Hardware value", sum(g.value for g in rows)),
			money_tile("Subscriptions / month", sum(g.subs_month for g in rows), "lav"),
			money_tile("Idle hardware value", sum(g.idle_value for g in rows), "orange"),
			money_tile("Idle subscriptions / month", sum(g.idle_month for g in rows), "red"),
		],
		"chart": chart("Hardware value by sub-category", rows, "sub_category", "value"),
	}


def _r_item_utilisation(f):
	brands = dict(frappe.get_all("Item", filters={"is_fixed_asset": 1}, fields=["name", "brand"], as_list=True))
	items = {}
	for a in _assets(f):
		i = items.setdefault(a.item, frappe._dict(item=a.item, item_sub=f"{a.category} › {a.sub_category}", brand=brands.get(a.item) or "—",
			type=a.category_type, units=0, assigned=0, available=0, repair=0, cost=0.0, idle_month=0.0, idle_value=0.0))
		i.units += 1
		i.cost += flt(a.purchase_cost)
		if a.status == "Assigned":
			i.assigned += 1
		elif a.status == "Under Repair":
			i.repair += 1
			i.idle_value += hw_value(a)
		else:
			i.available += 1
			i.idle_month += sub_monthly(a)
			i.idle_value += hw_value(a)
	rows = sorted(items.values(), key=lambda i: (-i.units, i.item))
	for i in rows:
		i.utilisation = i.assigned / i.units * 100 if i.units else 0
		i.unit_cost = i.cost / i.units if i.units else 0
	return {
		"columns": [
			col("item", "Item", sub=True), col("brand", "Brand"), col("type", "Type", "status"), col("units", "Units", "int", True),
			col("assigned", "Assigned", "int", True), col("available", "Available", "int", True), col("repair", "Under repair", "int", True),
			col("utilisation", "Utilisation", "bar"), col("unit_cost", "Avg unit cost", "money"),
			col("idle_value", "Idle hardware value", "money", True), col("idle_month", "Idle subscriptions / month", "money", True),
		],
		"rows": rows,
		"summary": [
			tile("Items", len(rows)), tile("Units", sum(i.units for i in rows)),
			tile("Fully used items", len([i for i in rows if i.units and i.assigned == i.units]), "int", "lime"),
			tile("Items with idle units", len([i for i in rows if i.available]), "int", "orange"),
			money_tile("Idle hardware value", sum(i.idle_value for i in rows), "orange"),
			money_tile("Idle subscriptions / month", sum(i.idle_month for i in rows), "red"),
		],
		"chart": chart("Utilisation % by item", rows, "item", "utilisation", "pct", 16),
	}


def _r_subscription_seats(f):
	subs = {}
	for a in [a for a in _assets(f) if a.is_subscription]:
		s = subs.setdefault(a.item, frappe._dict(item=a.item, item_sub=a.sub_category, cycle=a.billing_cycle or "—", seats=0, used=0, free=0,
			seat_month=0.0, monthly=0.0, wasted=0.0, annual=0.0, next_renewal=None))
		s.seats += 1
		m = sub_monthly(a)
		s.monthly += m
		s.seat_month = m
		if a.status == "Assigned":
			s.used += 1
		else:
			s.free += 1
			s.wasted += m
		if a.expiry_date and (not s.next_renewal or getdate(a.expiry_date) < getdate(s.next_renewal)):
			s.next_renewal = a.expiry_date
	rows = sorted(subs.values(), key=lambda s: -s.monthly)
	for s in rows:
		s.annual = s.monthly * 12
		s.usage = s.used / s.seats * 100 if s.seats else 0
	return {
		"columns": [
			col("item", "Subscription", sub=True), col("cycle", "Billing"), col("seats", "Seats", "int", True), col("used", "Used", "int", True),
			col("free", "Free", "int", True), col("usage", "Seat usage", "bar"), col("seat_month", "Per seat / month", "money"),
			col("monthly", "Monthly cost", "money", True, strong=True), col("annual", "Annual cost", "money", True),
			col("wasted", "Unused seats / month", "money", True, tone="neg"), col("next_renewal", "Next renewal", "date"),
		],
		"rows": rows,
		"summary": [
			tile("Subscriptions", len(rows)), tile("Seats", sum(s.seats for s in rows)),
			tile("Free seats", sum(s.free for s in rows), "int", "orange"),
			money_tile("Monthly cost", sum(s.monthly for s in rows), "lav"),
			money_tile("Annual cost", sum(s.annual for s in rows)),
			money_tile("Unused seats / year", sum(s.wasted for s in rows) * 12, "red"),
		],
		"chart": chart("Monthly cost by subscription", rows, "item", "monthly"),
	}


# ---------------------------------------------------------------- lifecycle


def _r_idle_assets(f):
	assets = [a for a in _assets(f) if a.status in ("Available", "Under Repair")]
	last = {}
	for p in api._periods(api._movements([a.name for a in assets])):
		if p["returned_on"]:
			last[p["asset"]] = max(last.get(p["asset"], getdate("1900-01-01")), getdate(p["returned_on"]))
	today = getdate(nowdate())
	rows = []
	for a in assets:
		since = last.get(a.name) or getdate(a.purchase_date)
		rows.append(frappe._dict(asset=a.name, asset_sub=a.serial_no or "", category=a.category, sub_category=a.sub_category, type=a.category_type,
			status=a.status, idle_since=since, days=date_diff(today, since), value=hw_value(a), month=monthly(a),
			returned=bool(last.get(a.name)), _go=f"asset|{a.name}"))
	rows.sort(key=lambda r: -r.days)
	return {
		"columns": [
			col("asset", "Asset", sub=True), col("category", "Category"), col("sub_category", "Sub-category"), col("status", "Status", "status"),
			col("idle_since", "Idle since", "date"), col("days", "Days idle", "int"), col("value", "Hardware value", "money", True),
			col("month", "Cost / month", "money", True),
		],
		"rows": rows,
		"summary": [
			tile("Idle assets", len(rows)), tile("Never assigned", len([r for r in rows if not r.returned]), "int", "orange"),
			tile("Idle 90+ days", len([r for r in rows if r.days >= 90]), "int", "red"),
			money_tile("Idle hardware value", sum(r.value for r in rows), "orange"),
			money_tile("Idle cost / month", sum(r.month for r in rows), "red"),
			tile("Avg days idle", sum(r.days for r in rows) / (len(rows) or 1)),
		],
		"chart": chart("Days idle", rows, "asset", "days", "int"),
	}


def _r_renewals(f):
	"""One row per asset with its next date; a subscription counts every renewal inside the window (monthly = each month)."""
	months = int(f.get("months") or 12)
	today = getdate(nowdate())
	until = getdate(add_months(today, months))
	emps = _employees()
	rows, by_month = [], {}
	for a in _assets(f):
		if not a.expiry_date or getdate(a.expiry_date) >= until:
			continue
		e = emps.get(a.assigned_to) if a.assigned_to else None
		sub = a.is_subscription
		d = getdate(a.expiry_date)
		row = frappe._dict(asset=a.name, asset_sub=f"{a.category} › {a.sub_category}", kind="Renewal" if sub else ("Warranty expired" if d < today else "Warranty ends"),
			date=d, days=date_diff(d, today), cycle=a.billing_cycle if sub else None, holder=e.employee_name if e else "—",
			department=e.department if e else "—", cost=None, renewals=None, window_cost=None, _go=f"asset|{a.name}")
		if sub:
			cost = flt(a.purchase_cost)
			step = 12 if a.billing_cycle == "Yearly" else 1
			row.cost, row.renewals, row.window_cost = cost, 0, 0.0
			if d < today:  # renewal date passed without being moved on: one payment overdue
				by_month["Overdue"] = by_month.get("Overdue", 0) + cost
				while d < today:
					d = getdate(add_months(d, step))
			while d < until:  # window end is exclusive: 12 months = 12 monthly renewals
				key = d.strftime("%Y-%m")
				by_month[key] = by_month.get(key, 0) + cost
				row.renewals += 1
				row.window_cost += cost
				d = getdate(add_months(d, step))
		rows.append(row)
	rows.sort(key=lambda r: r.date)
	label = lambda k: k if k == "Overdue" else getdate(f"{k}-01").strftime("%b %Y")
	in_30 = getdate(add_months(today, 1))
	next_30 = 0.0
	for a in rows:
		if a.cost:
			d, step = getdate(a.date), 12 if a.cycle == "Yearly" else 1
			while d < today:
				d = getdate(add_months(d, step))
			while d < in_30:
				next_30 += a.cost
				d = getdate(add_months(d, step))
	return {
		"columns": [
			col("asset", "Asset", sub=True), col("kind", "What", "status"), col("date", "Next due", "date"), col("days", "Days left", "days"),
			col("cycle", "Billing"), col("holder", "Holder"), col("department", "Department", "dept"), col("cost", "Cost per renewal", "money"),
			col("renewals", "Renewals in window", "int", True), col("window_cost", "Renewal cost in window", "money", True, strong=True),
		],
		"rows": rows,
		"summary": [
			tile("Subscriptions renewing", len([r for r in rows if r.kind == "Renewal"]), "int", "lav"),
			tile("Renewals in window", sum(r.renewals or 0 for r in rows)),
			tile("Warranties ending", len([r for r in rows if r.kind == "Warranty ends"]), "int", "orange"),
			tile("Warranties expired", len([r for r in rows if r.kind == "Warranty expired"]), "int", "red"),
			money_tile(f"Renewal cost, next {months} months", sum(r.window_cost or 0 for r in rows), "lime"),
			money_tile("Next 30 days", next_30),
		],
		"chart": {"title": "Subscription renewal cost by month", "type": "money", "keep_order": True,
			"rows": [{"label": label(k), "value": v} for k, v in sorted(by_month.items(), key=lambda kv: "0" if kv[0] == "Overdue" else kv[0]) if v]},
	}


def _r_custody_log(f):
	emps = _employees()
	assets = _assets(f) + [a for a in api._assets({"category": f.get("category")}) if a.status == "Disposed"]
	start = getdate(f.date_from) if f.get("date_from") else None
	end = getdate(f.date_to) if f.get("date_to") else None
	rows = []
	for p in _periods(assets):
		e = emps.get(p["employee"])
		if f.get("department") and (not e or e.department != f.department):
			continue
		got, back = getdate(p["assigned_on"]), getdate(p["returned_on"]) if p["returned_on"] else None
		if end and got > end:
			continue
		if start and back and back < start:
			continue
		a = p["asset_row"]
		rows.append(frappe._dict(asset=a.name, asset_sub=f"{a.category} › {a.sub_category}", employee=e.employee_name if e else p["employee"],
			employee_sub=p["employee"], department=e.department if e else "—", assigned_on=got, returned_on=back,
			days=p["days"], status="Returned" if back else "Assigned", spend=_spend(p), value=hw_value(a), movement=p["movement"],
			_go=f"employee|{p['employee']}"))
	rows.sort(key=lambda r: r.assigned_on, reverse=True)
	returned = [r for r in rows if r.returned_on]
	return {
		"columns": [
			col("asset", "Asset", sub=True), col("employee", "Employee", sub=True), col("department", "Department", "dept"),
			col("assigned_on", "Assigned", "date"), col("returned_on", "Returned", "date"), col("days", "Days held", "int"),
			col("status", "Status", "status"), col("value", "Hardware value", "money"), col("spend", "Subscription cost in period", "money", True),
			col("movement", "Asset Movement"),
		],
		"rows": rows,
		"summary": [
			tile("Assignments", len(rows)), tile("Still held", len(rows) - len(returned), "int", "lime"), tile("Returned", len(returned), "int", "lav"),
			tile("Avg days held (returned)", sum(r.days for r in returned) / (len(returned) or 1)),
			tile("Employees", len({r.employee_sub for r in rows})),
			money_tile("Subscription cost in period", sum(r.spend for r in rows)),
		],
		"chart": chart("Days held by employee", _sum_by(rows, "employee", "days"), "employee", "days", "int"),
	}


def _sum_by(rows, key, value):
	out = {}
	for r in rows:
		out[r[key]] = out.get(r[key], 0) + flt(r[value])
	return [{key: k, value: v} for k, v in out.items()]


def _r_asset_ageing(f):
	today = getdate(nowdate())
	buckets = [("Under 1 year", 0, 365), ("1–2 years", 365, 730), ("2–3 years", 730, 1095), ("3+ years", 1095, 10**6)]
	groups = {}
	for a in _assets(f):
		age = date_diff(today, a.purchase_date) if a.purchase_date else 0
		label = next(b[0] for b in buckets if b[1] <= age < b[2])
		g = groups.setdefault((a.category, label), frappe._dict(category=a.category, bucket=label, assets=0, assigned=0, value=0.0,
			subs_month=0.0, expired=0, age_total=0, _order=[b[0] for b in buckets].index(label)))
		g.assets += 1
		g.assigned += a.status == "Assigned"
		g.value += hw_value(a)
		g.subs_month += sub_monthly(a)
		g.age_total += age
		if not a.is_subscription and a.expiry_date and getdate(a.expiry_date) < today:
			g.expired += 1
	rows = sorted(groups.values(), key=lambda g: (g.category or "", g._order))
	for g in rows:
		g.avg_age = g.age_total / g.assets / 365 if g.assets else 0
	return {
		"columns": [
			col("category", "Category"), col("bucket", "Age"), col("assets", "Assets", "int", True), col("assigned", "Assigned", "int", True),
			col("avg_age", "Avg age (years)", "dec"), col("value", "Hardware value", "money", True),
			col("subs_month", "Subscriptions / month", "money", True), col("expired", "Out of warranty", "int", True),
		],
		"rows": rows,
		"summary": [
			tile("Assets", sum(g.assets for g in rows)),
			tile("3+ years old", sum(g.assets for g in rows if g.bucket == "3+ years"), "int", "orange"),
			tile("Out of warranty", sum(g.expired for g in rows), "int", "red"),
			money_tile("Hardware value", sum(g.value for g in rows)),
			money_tile("Value under 1 year", sum(g.value for g in rows if g.bucket == "Under 1 year"), "lime"),
			money_tile("Value 3+ years", sum(g.value for g in rows if g.bucket == "3+ years"), "orange"),
		],
		"chart": {"title": "Assets by age", "type": "int", "keep_order": True,
			"rows": [{"label": b[0], "value": sum(g.assets for g in rows if g.bucket == b[0])} for b in buckets]},
	}


def _r_leavers(f):
	emps = _employees()
	rows = []
	for a in _assets(f):
		e = emps.get(a.assigned_to) if a.assigned_to else None
		if not e or e.status == "Active":
			continue
		rows.append(frappe._dict(employee=e.employee_name, employee_sub=e.name, status=e.status, relieving_date=e.relieving_date,
			department=e.department, asset=a.name, asset_sub=f"{a.category} › {a.sub_category}", since=a.assigned_on,
			value=hw_value(a), month=sub_monthly(a), _go=f"asset|{a.name}"))
	rows.sort(key=lambda r: (r.employee, r.asset))
	return {
		"columns": [
			col("employee", "Employee", sub=True), col("status", "Employee status", "status"), col("relieving_date", "Relieving date", "date"),
			col("department", "Department", "dept"), col("asset", "Asset", sub=True), col("since", "Held since", "date"),
			col("value", "Hardware value", "money", True), col("month", "Subscription / month", "money", True),
		],
		"rows": rows,
		"summary": [
			tile("Leavers with assets", len({r.employee_sub for r in rows}), "int", "red" if rows else ""),
			tile("Assets to recover", len(rows), "int", "orange" if rows else ""),
			money_tile("Hardware value to recover", sum(r.value for r in rows), "orange" if rows else ""),
			money_tile("Subscriptions still billed / month", sum(r.month for r in rows), "red" if rows else ""),
		],
		"chart": chart("Value to recover by employee", _sum_by(rows, "employee", "value"), "employee", "value"),
		"empty": "No leavers are holding assets. Employees whose status is not Active and who still have a Custodian asset appear here.",
	}


def _r_employee_register(f):
	emps = _employees()
	rows = []
	for a in _held_by(_assets(f), emps, f):
		e = emps.get(a.assigned_to)
		rows.append(frappe._dict(employee=e.employee_name if e else a.assigned_to, employee_sub=a.assigned_to, department=e.department if e else "—",
			designation=(e.designation if e else "") or "—", asset=a.name, asset_sub=a.serial_no or "", category=a.category, sub_category=a.sub_category,
			type=a.category_type, is_sub=a.is_subscription, since=a.assigned_on, value=hw_value(a), month=monthly(a), expiry=a.expiry_date, _go=f"asset|{a.name}"))
	rows.sort(key=lambda r: (r.employee, r.category or "", r.asset))
	return {
		"columns": [
			col("employee", "Employee", sub=True), col("department", "Department", "dept"), col("designation", "Designation"),
			col("asset", "Asset", sub=True), col("category", "Category"), col("sub_category", "Sub-category"), col("type", "Type", "status"),
			col("since", "Since", "date"), col("value", "Hardware value", "money", True), col("month", "Cost / month", "money", True),
			col("expiry", "Warranty / renewal", "date"),
		],
		"rows": rows,
		"summary": [
			tile("Assets with employees", len(rows)), tile("Employees", len({r.employee_sub for r in rows})),
			tile("Hardware", len([r for r in rows if not r.is_sub]), "int", "lime"),
			tile("Subscriptions", len([r for r in rows if r.is_sub]), "int", "lav"),
			money_tile("Hardware value", sum(r.value for r in rows)),
			money_tile("Monthly cost", sum(r.month for r in rows)),
		],
		"chart": chart("Assets per employee", _sum_by([dict(r, n=1) for r in rows], "employee", "n"), "employee", "n", "int"),
	}
