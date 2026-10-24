"""Public page (no login) where an employee acknowledges assets handed to them: /asset-acknowledgement?key=...

The key is the Asset Acknowledgement's random link key from the email; the page shows only that hand-over.
"""

import frappe
from frappe.utils import flt

from asset_management.asset_management.acknowledgement import by_key, settings

no_cache = 1


def get_context(context):
	context.no_cache = 1
	context.title = "Asset Acknowledgement"
	ack = by_key(frappe.form_dict.get("key"))
	if not ack:
		context.state = "invalid"
		return context
	context.state = ack.status.lower()  # pending / completed / cancelled
	context.key = ack.key
	# plain values only (not the Document) for the template
	context.ack = frappe._dict(
		name=ack.name, employee=ack.employee, employee_name=ack.employee_name,
		assigned_on=ack.assigned_on, acknowledged_on=ack.acknowledged_on,
	)
	context.company = ack.company
	context.message = settings().acknowledgement_message
	context.assets = [
		{
			"asset_name": i.asset_name or i.asset,
			"item_code": i.item_code,
			"sub_category": i.sub_category,
			"serial_no": i.serial_no,
			"location": i.location,
			"stars": round(flt(i.condition_rating) * 5),
			"condition_notes": i.condition_notes,
		}
		for i in ack.items
	]
	return context
