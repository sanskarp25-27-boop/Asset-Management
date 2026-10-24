import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import validate_email_address


class AssetManagementSettings(Document):
	def validate(self):
		for email in split_emails(self.it_team_emails):
			if not validate_email_address(email):
				frappe.throw(_("{0} is not a valid email address.").format(email))
		from asset_management.asset_management.naming import split, validate_series

		options = split(self.naming_series_options)
		for series in options:
			validate_series(series)
		self.naming_series_options = "\n".join(options) or None
		if options and self.default_naming_series not in options:
			self.default_naming_series = options[0]

	def on_update(self):
		# the Asset form offers these series, with the default preselected
		from asset_management.asset_management.naming import apply, split

		if split(self.naming_series_options):
			apply(self.naming_series_options, self.default_naming_series)


def split_emails(value):
	return [e.strip() for e in (value or "").replace(";", ",").replace("\n", ",").split(",") if e.strip()]
