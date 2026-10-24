app_name = "asset_management"
app_title = "Asset Management"
app_publisher = "Infinite Locus"
app_description = "Employee asset tracking (IT hardware and subscriptions) on ERPNext's standard Assets module"
app_license = "mit"

required_apps = ["erpnext"]

# custom fields, naming series, list columns and the Assets sidebar link (re-applied on every migrate)
after_install = "asset_management.asset_management.setup.setup_asset_management"
after_migrate = "asset_management.asset_management.setup.setup_asset_management"

doctype_js = {
	# Specifications tab: rows follow the item's sub-category
	"Asset": "public/js/asset.js",
}

doc_events = {
	"Asset": {
		# "Macbook Air M1 - 001" naming on the standard Asset
		"before_insert": "asset_management.asset_management.asset.before_insert",
		"after_insert": "asset_management.asset_management.asset.after_insert",
		# specifications per sub-category (Item Group > Specification Fields)
		"validate": "asset_management.asset_management.specifications.validate_asset",
		"before_update_after_submit": "asset_management.asset_management.specifications.validate_asset",
	},
	# hand-over acknowledgement email when an asset is assigned / transferred to an employee
	"Asset Movement": {
		"on_submit": "asset_management.asset_management.acknowledgement.on_movement_submit",
		"on_cancel": "asset_management.asset_management.acknowledgement.on_movement_cancel",
	},
}
