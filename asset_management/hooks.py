app_name = "asset_management"
app_title = "Asset Management"
app_publisher = "Infinite Locus"
app_description = "Employee asset tracking (IT hardware and subscriptions) on ERPNext's standard Assets module"
app_license = "mit"

required_apps = ["erpnext"]

# custom fields, naming series, list columns and the Assets sidebar link (re-applied on every migrate)
after_install = "asset_management.asset_management.setup.setup_asset_management"
after_migrate = "asset_management.asset_management.setup.setup_asset_management"

doc_events = {
	# "Macbook Air M1 - 001" naming on the standard Asset
	"Asset": {
		"before_insert": "asset_management.asset_management.asset.before_insert",
		"after_insert": "asset_management.asset_management.asset.after_insert",
	},
}
