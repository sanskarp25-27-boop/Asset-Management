"""Asset Management on ERPNext's standard Assets module. Runs after install and every migrate (hooks.py); safe to re-run.

Hierarchy, all standard records:
	Category      = Asset Category                      (IT Hardware, Subscriptions)
	Sub-Category  = Item Group under the category's group (IT Hardware > Laptop)
	Item          = Item, a non-stock Fixed Asset item     (Macbook Air M1)
	Asset         = Asset, named "<Item Name> - 001"       (Macbook Air M1 - 001)
Assign / return = a standard Asset Movement (Issue / Receipt), which sets the Asset's Custodian.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.custom.doctype.property_setter.property_setter import make_property_setter

PAGE = "asset-workspace"
# ".{item_name}. - .###" -> "Macbook Air M1 - 001", with a counter per item; asset.py then copies the name into
# Asset Name so the standard list shows it
ITEM_SERIES = ".{item_name}. - .###"
DEFAULT_SERIES = "ACC-ASS-.YYYY.-"


def setup_asset_management():
	create_custom_fields(
		{
			"Asset Category": [
				{
					"fieldname": "asset_category_type",
					"label": "Category Type",
					"fieldtype": "Select",
					"options": "Hardware\nSubscription",
					"default": "Hardware",
					"insert_after": "asset_category_name",
					"in_list_view": 1,
					"description": "Subscriptions show a renewal date and billing cycle in the Asset Workspace.",
				},
			],
			"Asset": [
				{
					"fieldname": "asset_sub_category",
					"label": "Sub-Category",
					"fieldtype": "Link",
					"options": "Item Group",
					"fetch_from": "item_code.item_group",
					"read_only": 1,
					"insert_after": "asset_category",
					"in_list_view": 1,
					"in_standard_filter": 1,
				},
				{
					"fieldname": "asset_serial_no",
					"label": "Serial No / Licence ID",
					"fieldtype": "Data",
					"insert_after": "asset_sub_category",
					"in_standard_filter": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "warranty_renewal_date",
					"label": "Warranty / Renewal Date",
					"fieldtype": "Date",
					"insert_after": "purchase_date",
					"allow_on_submit": 1,
				},
				{
					"fieldname": "billing_cycle",
					"label": "Billing Cycle (subscriptions)",
					"fieldtype": "Select",
					"options": "\nMonthly\nYearly",
					"insert_after": "warranty_renewal_date",
					"allow_on_submit": 1,
				},
			],
		},
		update=True,
	)
	setup_naming()
	setup_sidebar()


def setup_naming():
	"""Default Asset names to "<Asset Name> - 001"; the standard ACC-ASS- series stays selectable."""
	options = frappe.get_meta("Asset").get_field("naming_series").options or DEFAULT_SERIES
	series = [s for s in options.split("\n") if s and not s.startswith(".{")]  # drop earlier versions of ours
	make_property_setter("Asset", "naming_series", "options", "\n".join([ITEM_SERIES, *series]), "Text", validate_fields_for_doctype=False)
	make_property_setter("Asset", "naming_series", "default", ITEM_SERIES, "Text", validate_fields_for_doctype=False)
	# employee mapping in the standard Asset list: who holds each asset
	make_property_setter("Asset", "custodian", "in_list_view", 1, "Check", validate_fields_for_doctype=False)
	make_property_setter("Asset", "custodian", "in_standard_filter", 1, "Check", validate_fields_for_doctype=False)


def setup_sidebar():
	"""Link the Asset Workspace page from the standard Assets sidebar, under "Asset".

	Written straight to the table: saving the standard Sidebar in developer mode would export it into erpnext's files.
	An ERPNext update can re-sync the sidebar, so this runs on every migrate.
	"""
	if not frappe.db.exists("Sidebar", "Assets"):
		return
	if frappe.db.exists("Sidebar Item", {"parent": "Assets", "parenttype": "Sidebar", "link_to": PAGE}):
		return
	after = frappe.db.get_value("Sidebar Item", {"parent": "Assets", "parenttype": "Sidebar", "link_type": "DocType", "link_to": "Asset"}, "idx") or 1
	frappe.db.sql(
		"update `tabSidebar Item` set idx = idx + 1 where parent = 'Assets' and parenttype = 'Sidebar' and idx > %s", after
	)
	frappe.get_doc(
		{
			"doctype": "Sidebar Item",
			"parent": "Assets",
			"parenttype": "Sidebar",
			"parentfield": "items",
			"idx": after + 1,
			"type": "Link",
			"label": "Asset Workspace",
			"link_type": "Page",
			"link_to": PAGE,
			"icon": "users",
			"added": 1,
		}
	).db_insert()
	frappe.clear_cache()
