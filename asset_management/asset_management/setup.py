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


CATEGORY_TYPE = "Asset Category Type"
# the built-in types; more can be added from the Asset Workspace (Catalogue) or the Asset Category Type list
DEFAULT_TYPES = {"Hardware": (0, "blue"), "Subscription": (1, "purple")}


def setup_category_types():
	"""Create the built-in Category Types, and one for any type already on an Asset Category."""
	in_use = {t for t in frappe.get_all("Asset Category", pluck="asset_category_type") if t} if frappe.db.has_column(
		"Asset Category", "asset_category_type"
	) else set()
	for name in [*DEFAULT_TYPES, *sorted(in_use - set(DEFAULT_TYPES))]:
		if frappe.db.exists(CATEGORY_TYPE, name):
			continue
		is_subscription, color = DEFAULT_TYPES.get(name, (0, "gray"))
		frappe.get_doc({"doctype": CATEGORY_TYPE, "type_name": name, "is_subscription": is_subscription, "color": color}).insert(
			ignore_permissions=True
		)


def convert_category_type_field():
	"""Category Type was a Select (Hardware / Subscription); it is now a Link to Asset Category Type.

	Frappe refuses that change through create_custom_fields, but both are stored as text, so the
	Custom Field record is switched in place and the values stay as they are.
	"""
	name = frappe.db.get_value("Custom Field", {"dt": "Asset Category", "fieldname": "asset_category_type"})
	if name and frappe.db.get_value("Custom Field", name, "fieldtype") == "Select":
		frappe.db.set_value("Custom Field", name, {"fieldtype": "Link", "options": CATEGORY_TYPE}, update_modified=False)
		frappe.clear_cache(doctype="Asset Category")


def setup_asset_management():
	setup_category_types()
	convert_category_type_field()
	create_custom_fields(
		{
			"Asset Category": [
				{
					"fieldname": "asset_category_type",
					"label": "Category Type",
					"fieldtype": "Link",
					"options": CATEGORY_TYPE,
					"default": "Hardware",
					"reqd": 1,
					"insert_after": "asset_category_name",
					"in_list_view": 1,
					"in_standard_filter": 1,
					"link_filters": '[["Asset Category Type","disabled","=",0]]',
					"description": "Hardware, Subscription, or a type you add. Subscription-like types show a renewal date and billing cycle in the Asset Workspace.",
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
	setup_handover_fields()
	setup_settings()
	setup_naming()
	setup_sidebar()


def setup_settings():
	"""Store the default of every Asset Management Settings field never saved yet (a never-saved Check reads as 0, so
	"acknowledgements on" / "rating required" would otherwise read as off). Values already set are left alone."""
	doctype = "Asset Management Settings"
	for df in frappe.get_meta(doctype).fields:
		if df.default is not None and not frappe.db.exists("Singles", {"doctype": doctype, "field": df.fieldname}):
			frappe.db.set_single_value(doctype, df.fieldname, df.default)


def setup_handover_fields():
	"""Specifications per sub-category, condition at hand-over and acknowledgement status (all on standard doctypes)."""
	# standard fields only, so a re-run does not anchor the tab on its own table
	asset_fields = [f.fieldname for f in frappe.get_meta("Asset").fields if not f.get("is_custom_field")]
	# the Specifications tab goes just before the standard Connections tab
	before_connections = asset_fields[asset_fields.index("connections_tab") - 1] if "connections_tab" in asset_fields else asset_fields[-1]
	create_custom_fields(
		{
			"Item Group": [
				{
					"fieldname": "asset_specifications_section",
					"label": "Asset Specification Fields",
					"fieldtype": "Section Break",
					"insert_after": "taxes",
					"collapsible": 1,
					"description": "For an asset sub-category: the specifications asked for on each of its assets (e.g. Laptop: RAM, SSD; CCTV: Resolution, Lens).",
				},
				{
					"fieldname": "asset_specification_fields",
					"label": "Specification Fields",
					"fieldtype": "Table",
					"options": "Asset Specification Field",
					"insert_after": "asset_specifications_section",
				},
			],
			"Asset": [
				{
					"fieldname": "acknowledgement_status",
					"label": "Acknowledgement",
					"fieldtype": "Select",
					"options": "\nPending\nCompleted",
					"insert_after": "custodian",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
					"in_standard_filter": 1,
					"depends_on": "custodian",
					"description": "Whether the current custodian has acknowledged receiving this asset.",
				},
				{
					"fieldname": "current_acknowledgement",
					"label": "Acknowledgement Record",
					"fieldtype": "Link",
					"options": "Asset Acknowledgement",
					"insert_after": "acknowledgement_status",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
					"depends_on": "current_acknowledgement",
				},
				{
					"fieldname": "specifications_tab",
					"label": "Specifications",
					"fieldtype": "Tab Break",
					"insert_after": before_connections,
				},
				{
					"fieldname": "asset_specifications",
					"label": "Specifications",
					"fieldtype": "Table",
					"options": "Asset Specification",
					"insert_after": "specifications_tab",
					"allow_on_submit": 1,
					"description": "Rows follow the sub-category's Specification Fields (Item Group). Fill the values; mandatory ones are needed to submit.",
				},
			],
			"Asset Movement Item": [
				{
					"fieldname": "condition_rating",
					"label": "Condition at Hand-over",
					"fieldtype": "Rating",
					"insert_after": "to_employee",
					"description": "Recorded by IT when the asset is handed to an employee.",
				},
				{
					"fieldname": "condition_notes",
					"label": "Condition Notes",
					"fieldtype": "Small Text",
					"insert_after": "condition_rating",
				},
			],
		},
		update=True,
	)


def setup_naming():
	"""Asset naming series from Asset Management Settings (Asset Workspace > Settings). The first time, the default is
	"<Item Name> - 001" with the standard ACC-ASS- series selectable, and that is saved to the Settings."""
	from asset_management.asset_management.naming import apply, split

	saved = frappe.db.get_single_value("Asset Management Settings", "naming_series_options")
	if split(saved):
		apply(saved, frappe.db.get_single_value("Asset Management Settings", "default_naming_series") or split(saved)[0])
	else:
		options = frappe.get_meta("Asset").get_field("naming_series").options or DEFAULT_SERIES
		series = [s for s in options.split("\n") if s and not s.startswith(".{")]  # drop earlier versions of ours
		options = "\n".join([ITEM_SERIES, *series])
		apply(options, ITEM_SERIES)
		frappe.db.set_single_value("Asset Management Settings", {"naming_series_options": options, "default_naming_series": ITEM_SERIES})
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
