"""Sample data on ERPNext's standard Assets module: two Asset Categories (IT Hardware, Subscriptions), their
sub-categories (Item Groups), Fixed Asset Items, submitted Assets, sample Employees and Asset Movements.

Run once:  bench --site <site> execute asset_management.asset_management.sample_data.load
Safe to re-run: existing records are kept, and movements are only made when no asset has a custodian history yet.
Uses the site's default company; accounts and departments are looked up by that company's abbreviation.
For demo / staging sites only: it creates 8 sample employees.
"""

import frappe
from frappe.utils import add_days, add_months, add_years, getdate, nowdate

from asset_management.asset_management import api

COMPANY = None  # set by load(): the site's default company
ABBR = None
LOCATION = "Head Office"

# category -> (type, fixed asset account (without " - <abbr>"), {sub-category -> [(item, brand, units, cost, billing cycle, serial prefix)]})
CATALOGUE = {
	"IT Hardware": ("Hardware", "Electronic Equipment", {
		"Laptop": [
			("Macbook Air M1", "Apple", 4, 92900, None, "C02F"),
			("Dell Latitude 5440", "Dell", 3, 78500, None, "DL54"),
			("Lenovo ThinkPad E14", "Lenovo", 2, 64000, None, "PF3K"),
		],
		"Monitor": [
			("Dell P2422H 24 inch", "Dell", 3, 17500, None, "CN0D"),
			("LG 27UL500 27 inch 4K", "LG", 2, 26900, None, "LG27"),
		],
		"Mobile Phone": [
			("iPhone 13", "Apple", 2, 59900, None, "F17X"),
		],
		"Accessories": [
			("Logitech MX Keys", "Logitech", 3, 9995, None, "MXK"),
			("Logitech MX Master 3S", "Logitech", 3, 8995, None, "MXM"),
		],
	}),
	"Subscriptions": ("Subscription", "Office Equipment", {
		"Productivity Suite": [
			("Microsoft 365 Business Standard", "Microsoft", 4, 770, "Monthly", "M365"),
			("Google Workspace Business Starter", "Google", 3, 137, "Monthly", "GWS"),
		],
		"Design Software": [
			("Figma Professional", "Figma", 2, 1250, "Monthly", "FIG"),
			("Adobe Creative Cloud All Apps", "Adobe", 2, 50760, "Yearly", "ACC"),
		],
		"Developer Tools": [
			("GitHub Copilot Business", "GitHub", 3, 1600, "Monthly", "GHC"),
			("JetBrains All Products Pack", "JetBrains", 2, 25000, "Yearly", "JBA"),
		],
		"Communication": [
			("Slack Pro", "Slack", 4, 7300, "Yearly", "SLK"),
			("Zoom Pro", "Zoom", 2, 13200, "Yearly", "ZM"),
		],
	}),
}

# (first, last, gender, designation, department (without " - <abbr>"), date of joining)
EMPLOYEES = [
	("Aarav", "Sharma", "Male", "Software Developer", "Research & Development", "2023-04-03"),
	("Priya", "Nair", "Female", "Designer", "Marketing", "2023-07-17"),
	("Rohan", "Mehta", "Male", "Product Manager", "Management", "2022-11-01"),
	("Ananya", "Iyer", "Female", "Software Developer", "Research & Development", "2024-01-08"),
	("Vikram", "Singh", "Male", "Sales Representative", "Sales", "2024-03-11"),
	("Neha", "Gupta", "Female", "HR Manager", "Human Resources", "2022-06-20"),
	("Karan", "Patel", "Male", "Accountant", "Accounts", "2023-09-04"),
	("Sneha", "Reddy", "Female", "Business Analyst", "Operations", "2024-06-03"),
]

# past custody: (employee, asset, issued on, returned on)
HISTORY = [
	("Karan Patel", "Lenovo ThinkPad E14 - 002", "2024-09-09", "2025-12-19"),
	("Karan Patel", "Dell Latitude 5440 - 003", "2025-01-13", "2026-09-28"),
	("Vikram Singh", "Figma Professional - 002", "2025-02-03", "2025-06-30"),
]

# employee -> (issued on, assets they hold now)
CURRENT = {
	"Aarav Sharma": ("2025-04-07", ["Macbook Air M1 - 001", "Dell P2422H 24 inch - 001", "Logitech MX Keys - 001",
		"Microsoft 365 Business Standard - 001", "GitHub Copilot Business - 001", "Slack Pro - 001"]),
	"Priya Nair": ("2025-05-12", ["Macbook Air M1 - 002", "LG 27UL500 27 inch 4K - 001", "Figma Professional - 001",
		"Adobe Creative Cloud All Apps - 001", "Microsoft 365 Business Standard - 002", "Slack Pro - 002"]),
	"Rohan Mehta": ("2025-03-03", ["Macbook Air M1 - 003", "iPhone 13 - 001", "Microsoft 365 Business Standard - 003",
		"Zoom Pro - 001", "Slack Pro - 003"]),
	"Ananya Iyer": ("2025-06-16", ["Dell Latitude 5440 - 001", "Dell P2422H 24 inch - 002", "Logitech MX Master 3S - 001",
		"GitHub Copilot Business - 002", "JetBrains All Products Pack - 001"]),
	"Vikram Singh": ("2025-07-01", ["Lenovo ThinkPad E14 - 001", "iPhone 13 - 002", "Google Workspace Business Starter - 001", "Zoom Pro - 002"]),
	"Neha Gupta": ("2025-02-10", ["Dell Latitude 5440 - 002", "Google Workspace Business Starter - 002"]),
	"Sneha Reddy": ("2026-01-05", ["Lenovo ThinkPad E14 - 002", "Google Workspace Business Starter - 003", "Logitech MX Keys - 002"]),
}


def load():
	global COMPANY, ABBR
	COMPANY = frappe.defaults.get_global_default("company") or frappe.get_all("Company", pluck="name", limit=1)[0]
	ABBR = frappe.db.get_value("Company", COMPANY, "abbr")
	_masters()
	_catalogue()
	employees = _employees()
	if not frappe.db.exists("Asset", {"custodian": ("is", "set")}) and not frappe.db.sql(
		"select 1 from `tabAsset Movement Item` where ifnull(to_employee, '') != '' limit 1"
	):
		_movements(employees)
	frappe.db.commit()
	print(
		f"Asset sample data ready: {frappe.db.count('Asset Category')} asset categories, "
		f"{frappe.db.count('Item', {'is_fixed_asset': 1})} fixed asset items, {frappe.db.count('Asset', {'docstatus': 1})} submitted assets, "
		f"{frappe.db.count('Asset', {'custodian': ('is', 'set')})} with employees, {len(employees)} employees."
	)


def _masters():
	for g in ("Male", "Female"):
		if not frappe.db.exists("Gender", g):
			frappe.get_doc({"doctype": "Gender", "gender": g}).insert(ignore_permissions=True)
	if not frappe.db.exists("Location", LOCATION):
		frappe.get_doc({"doctype": "Location", "location_name": LOCATION}).insert()
	brands = {i[1] for _, _, subs in CATALOGUE.values() for items in subs.values() for i in items}
	for b in brands:
		if not frappe.db.exists("Brand", b):
			frappe.get_doc({"doctype": "Brand", "brand": b}).insert()


def _catalogue():
	base = getdate("2024-04-01")
	n = 0
	for category, (ctype, account, subs) in CATALOGUE.items():
		if not frappe.db.exists("Asset Category", category):
			frappe.get_doc({
				"doctype": "Asset Category",
				"asset_category_name": category,
				"asset_category_type": ctype,
				"non_depreciable_category": 1 if ctype == "Subscription" else 0,
				"accounts": [{
					"company_name": COMPANY,
					"fixed_asset_account": _account(account, "Fixed Asset"),
					"accumulated_depreciation_account": _account("Accumulated Depreciations", "Accumulated Depreciation"),
					"depreciation_expense_account": _account("Depreciation", "Depreciation"),
				}],
			}).insert()
		api.ensure_category_group(category)
		for sub, items in subs.items():
			if not frappe.db.exists("Item Group", sub):
				frappe.get_doc({"doctype": "Item Group", "item_group_name": sub, "parent_item_group": category, "is_group": 0}).insert()
			for item, brand, units, cost, cycle, prefix in items:
				if not frappe.db.exists("Item", item):
					frappe.get_doc({
						"doctype": "Item",
						"item_code": item,
						"item_name": item,
						"item_group": sub,
						"brand": brand,
						"stock_uom": "Nos",
						"is_stock_item": 0,
						"is_fixed_asset": 1,
						"asset_category": category,
					}).insert()
				if frappe.db.count("Asset", {"item_code": item, "docstatus": ("<", 2)}):
					continue
				for i in range(units):
					n += 1
					bought = getdate(add_days(base, (n * 23) % 600))
					if ctype == "Hardware":
						# 1-year warranty on accessories and phones, 3 years on laptops and monitors
						expiry = add_years(bought, 1 if sub in ("Accessories", "Mobile Phone") else 3)
						serial = f"{prefix}{(n * 7919) % 100000:05d}"
					else:
						expiry = _next_renewal(bought, cycle)
						serial = f"{prefix}-LIC-{i + 1:04d}"
					asset = frappe.get_doc({
						"doctype": "Asset",
						"item_code": item,
						"asset_name": item,
						"asset_type": "Existing Asset",
						"company": COMPANY,
						"location": LOCATION,
						"purchase_date": bought,
						"available_for_use_date": bought,
						"net_purchase_amount": cost,
						"calculate_depreciation": 0,
						"asset_serial_no": serial,
						"warranty_renewal_date": expiry,
						"billing_cycle": cycle,
					})
					asset.insert()
					asset.submit()


def _account(base, account_type):
	""""<base> - <abbr>" if the company has it, else any ledger of that account type."""
	name = f"{base} - {ABBR}"
	if frappe.db.exists("Account", name):
		return name
	return frappe.db.get_value("Account", {"company": COMPANY, "account_type": account_type, "is_group": 0})


def _next_renewal(start, cycle):
	"""The first renewal on or after today for a subscription that started on `start`."""
	today = getdate(nowdate())
	d = getdate(start)
	while d < today:
		d = getdate(add_months(d, 1) if cycle == "Monthly" else add_years(d, 1))
	return d


def _employees():
	out = {}
	for first, last, gender, designation, department, joined in EMPLOYEES:
		full = f"{first} {last}"
		department = f"{department} - {ABBR}"
		name = frappe.db.get_value("Employee", {"employee_name": full})
		if not name:
			emp = frappe.get_doc({
				"doctype": "Employee",
				"first_name": first,
				"last_name": last,
				"gender": gender,
				"date_of_birth": "1995-01-15",
				"date_of_joining": joined,
				"company": COMPANY,
				"status": "Active",
				"designation": designation if frappe.db.exists("Designation", designation) else None,
				"department": department if frappe.db.exists("Department", department) else None,
				"company_email": f"{first.lower()}.{last.lower()}@example.com",
			})
			emp.insert(ignore_permissions=True)
			name = emp.name
		out[full] = name
	return out


def _movements(employees):
	"""Standard Asset Movements (Issue / Receipt) through the same calls the Asset Workspace uses."""
	last = {}  # asset -> date of its latest movement, so each movement comes after the previous one

	def after(asset, planned):
		floor = last.get(asset) or getdate(frappe.db.get_value("Asset", asset, "purchase_date"))
		return max(getdate(planned), getdate(add_days(floor, 2)))

	for employee, asset, issued, returned in HISTORY:
		on = after(asset, issued)
		api.assign([asset], employees[employee], str(on))
		back = max(getdate(returned), getdate(add_days(on, 30)))
		api.unassign([asset], str(back))
		last[asset] = back
	for employee, (issued, assets) in CURRENT.items():
		for asset in assets:
			on = after(asset, issued)
			api.assign([asset], employees[employee], str(on))
			last[asset] = on
