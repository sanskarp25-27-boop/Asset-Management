"""Specifications per asset sub-category.

Each sub-category (an Item Group under an Asset Category) lists its Specification Fields (Item Group >
asset_specification_fields: label, type, options, mandatory). Every Asset of that sub-category carries one
Asset Specification row per field (Asset > asset_specifications), so a Laptop asks for RAM and SSD while a
CCTV camera asks for Resolution and Lens. Values are stored as text; the type drives the input and the checks.
"""

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate

TYPES = ("Text", "Number", "Select", "Yes/No", "Date")


def options_of(value):
	"""Select choices, one per line or comma separated."""
	return [o.strip() for o in cstr(value).replace(",", "\n").split("\n") if o.strip()]


def fields_of(item_group):
	"""The sub-category's Specification Fields, in order."""
	if not item_group:
		return []
	return frappe.get_all(
		"Asset Specification Field",
		filters={"parent": item_group, "parenttype": "Item Group", "parentfield": "asset_specification_fields"},
		fields=["field_label", "field_type", "options", "mandatory", "per_unit"],
		order_by="idx asc",
	)


def sub_category_of(doc):
	return frappe.db.get_value("Item", doc.item_code, "item_group") if doc.get("item_code") else None


def sync_rows(doc, values=None):
	"""Make the asset's specification rows follow its sub-category's fields, keeping values already typed.
	values: {label: value} to fill in (bulk creation). Rows of fields no longer in the list are kept."""
	fields = fields_of(sub_category_of(doc))
	existing = {row.specification: row for row in doc.get("asset_specifications") or []}
	rows = []
	for f in fields:
		row = existing.pop(f.field_label, None)
		value = (values or {}).get(f.field_label, row.value if row else None)
		rows.append({"specification": f.field_label, "value": cstr(value).strip() if value not in (None, "") else None,
			"field_type": f.field_type, "options": f.options, "mandatory": f.mandatory})
	for row in existing.values():  # a field removed from the sub-category: keep what was recorded
		rows.append({"specification": row.specification, "value": row.value, "field_type": row.field_type,
			"options": row.options, "mandatory": 0})
	doc.set("asset_specifications", rows)


def clean_value(field_type, options, value, label):
	"""The value as stored, or an error message."""
	value = cstr(value).strip()
	if not value:
		return value
	if field_type == "Number":
		try:
			float(value.replace(",", ""))
		except ValueError:
			frappe.throw(_("{0} must be a number (got “{1}”).").format(label, value))
	elif field_type == "Select":
		choices = options_of(options)
		match = next((c for c in choices if c.lower() == value.lower()), None)
		if choices and not match:
			frappe.throw(_("{0} must be one of: {1} (got “{2}”).").format(label, ", ".join(choices), value))
		value = match or value
	elif field_type == "Yes/No":
		low = value.lower()
		if low in ("yes", "y", "1", "true"):
			value = "Yes"
		elif low in ("no", "n", "0", "false"):
			value = "No"
		else:
			frappe.throw(_("{0} must be Yes or No (got “{1}”).").format(label, value))
	elif field_type == "Date":
		try:
			value = str(getdate(value))
		except Exception:
			frappe.throw(_("{0} must be a date (got “{1}”).").format(label, value))
	return value


def validate_asset(doc, method=None):
	"""Asset validate hook: rows follow the sub-category; values are checked; mandatory ones are required once
	the asset is submitted (a draft can be saved half filled)."""
	if doc.get("asset_type") == "Composite Asset" and not doc.get("item_code"):
		return
	if doc.docstatus == 0 or not doc.get("asset_specifications"):
		sync_rows(doc)
	missing = []
	for row in doc.get("asset_specifications") or []:
		row.value = clean_value(row.field_type, row.options, row.value, row.specification) or None
		if row.mandatory and not row.value:
			missing.append(row.specification)
	# one asset per unit: a quantity above 1 is split into separate assets (split_asset) before it is submitted; this
	# comes first because the per-unit specifications are entered while splitting
	if doc.docstatus == 1 and cint(doc.get("asset_quantity")) > 1 and doc.get("asset_type") != "Composite Asset" and not doc.get("split_from"):
		frappe.throw(
			_("{0} has a quantity of {1}. Save it and enter each unit's serial number in the window that opens: it becomes {1} separate assets.").format(
				doc.name, cint(doc.asset_quantity)
			),
			title=_("One asset per unit"),
		)
	if missing and doc.docstatus == 1:
		frappe.throw(
			_("Fill the specification(s) {0} on the Specifications tab before submitting {1}.").format(
				", ".join(frappe.bold(m) for m in missing), doc.name or _("the asset")
			),
			title=_("Specifications missing"),
		)


def per_unit_fields(item_group):
	return [f for f in fields_of(item_group) if f.per_unit]


def check_units(units, item_group, exclude_asset=None):
	"""units: [{serial_no, specifications: {label: value}}]. Serial numbers unique and unused; per-unit values valid,
	mandatory ones filled. Returns the cleaned units."""
	fields = per_unit_fields(item_group)
	seen, out = set(), []
	for i, u in enumerate(units, start=1):
		u = frappe._dict(u)
		serial = cstr(u.serial_no).strip()
		if not serial:
			frappe.throw(_("Unit {0}: enter the serial number.").format(i))
		if serial.lower() in seen:
			frappe.throw(_("Serial number {0} is entered twice.").format(serial))
		seen.add(serial.lower())
		values = frappe._dict(frappe.parse_json(u.specifications) if isinstance(u.specifications, str) else (u.specifications or {}))
		clean = {}
		for f in fields:
			value = clean_value(f.field_type, f.options, values.get(f.field_label), f.field_label)
			if f.mandatory and not value:
				frappe.throw(_("Unit {0} ({1}): enter {2}.").format(i, serial, f.field_label))
			clean[f.field_label] = value
		out.append(frappe._dict(serial_no=serial, specifications=clean))
	filters = {"asset_serial_no": ("in", [u.serial_no for u in out]), "docstatus": ("<", 2)}
	if exclude_asset:
		filters["name"] = ("!=", exclude_asset)
	taken = frappe.get_all("Asset", filters=filters, fields=["name", "asset_serial_no"])
	if taken:
		frappe.throw(_("Already used by another asset: {0}").format(", ".join(f"{t.asset_serial_no} ({t.name})" for t in taken)))
	return out


@frappe.whitelist(methods=["POST"])
def split_asset(asset, units, shared=None, submit=1):
	"""A draft asset saved with quantity N becomes N assets of quantity 1: this one plus N-1 copies, each with its own
	serial number and per-unit specifications. The purchase amount is divided between them (any rounding on the first).
	shared: {label: value} for the specifications common to all units (filled in the same window). With submit, every
	asset is submitted; one failing undoes the whole split (the request is one transaction)."""
	doc = frappe.get_doc("Asset", asset)
	doc.check_permission("write")
	frappe.has_permission("Asset", "create", throw=True)
	if cint(submit):
		frappe.has_permission("Asset", "submit", throw=True)
	if doc.docstatus != 0:
		frappe.throw(_("{0} is already submitted. Use ERPNext's Split Asset on submitted assets.").format(doc.name))
	qty = cint(doc.asset_quantity)
	units = frappe.parse_json(units) if isinstance(units, str) else units
	if qty < 2:
		frappe.throw(_("{0} has a quantity of 1; there is nothing to split.").format(doc.name))
	if len(units or []) != qty:
		frappe.throw(_("Enter all {0} units.").format(qty))
	units = check_units(units, sub_category_of(doc), exclude_asset=doc.name)
	given = frappe.parse_json(shared) if isinstance(shared, str) else (shared or {})
	shared = {row.specification: row.value for row in doc.get("asset_specifications") or []}
	for f in fields_of(sub_category_of(doc)):
		if f.per_unit:
			continue
		if f.field_label in given:
			shared[f.field_label] = clean_value(f.field_type, f.options, given[f.field_label], f.field_label)
		if cint(submit) and f.mandatory and not shared.get(f.field_label):
			frappe.throw(_("Enter {0}: it is needed to submit the assets.").format(f.field_label))
	total = flt(doc.net_purchase_amount)
	if cint(submit) and total <= 0:
		frappe.throw(_("Enter the Net Purchase Amount on the asset first: ERPNext needs it to submit."))
	each = flt(total / qty, doc.precision("net_purchase_amount"))
	first = flt(total - each * (qty - 1), doc.precision("net_purchase_amount"))
	names = []
	for i, unit in enumerate(units):
		target = doc if i == 0 else frappe.copy_doc(doc)
		target.asset_quantity = 1
		target.asset_serial_no = unit.serial_no
		target.net_purchase_amount = first if i == 0 else each
		if i:
			target.asset_name = target.item_name  # renamed to its own "<Item> - 00n" after insert (asset.py)
		sync_rows(target, values={**shared, **unit.specifications})
		target.save() if i == 0 else target.insert()
		names.append(target.name)
	doc.add_comment("Info", _("Split into {0} assets (one per unit): {1}").format(qty, ", ".join(names)))
	if cint(submit):
		for name in names:
			frappe.get_doc("Asset", name).submit()
	return {"assets": names, "submitted": cint(submit)}


@frappe.whitelist()
def get_fields(item_group=None, item_code=None):
	"""Specification Fields of a sub-category (or of an item's sub-category)."""
	frappe.has_permission("Asset", "read", throw=True)
	if not item_group and item_code:
		item_group = frappe.db.get_value("Item", item_code, "item_group")
	return {"item_group": item_group, "fields": fields_of(item_group)}


@frappe.whitelist(methods=["POST"])
def save_fields(item_group, fields):
	"""Replace a sub-category's Specification Fields (from the Asset Workspace catalogue)."""
	doc = frappe.get_doc("Item Group", item_group)
	doc.check_permission("write")
	rows, seen = [], set()
	for f in frappe.parse_json(fields) or []:
		label = cstr(f.get("field_label")).strip()
		if not label:
			continue
		if label.lower() in seen:
			frappe.throw(_("{0} is listed twice.").format(label))
		seen.add(label.lower())
		field_type = f.get("field_type") or "Text"
		if field_type not in TYPES:
			frappe.throw(_("{0}: unknown type {1}.").format(label, field_type))
		if field_type == "Select" and not options_of(f.get("options")):
			frappe.throw(_("{0}: enter the choices for the Select field.").format(label))
		rows.append({"field_label": label, "field_type": field_type, "options": cstr(f.get("options")).strip() or None,
			"mandatory": 1 if f.get("mandatory") else 0, "per_unit": 1 if f.get("per_unit") else 0})
	doc.set("asset_specification_fields", rows)
	doc.save()
	return fields_of(item_group)
