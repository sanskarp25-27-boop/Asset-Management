import frappe
from frappe import _
from frappe.model.document import Document


class AssetCategoryType(Document):
	"""A kind of Asset Category (Hardware, Subscription, ...). Subscription-like types get renewal / billing handling."""

	def on_trash(self):
		used = frappe.get_all("Asset Category", filters={"asset_category_type": self.name}, pluck="name", limit=5)
		if used:
			frappe.throw(_("Category Type {0} is used by Asset Category {1}. Change those categories first.").format(self.name, ", ".join(used)))
