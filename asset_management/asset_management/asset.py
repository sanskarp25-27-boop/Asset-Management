"""Hooks on the standard Asset (hooks.py doc_events) for the "<Item Name> - 001" naming (setup.py ITEM_SERIES)."""

import frappe


def before_insert(doc, method=None):
	# the naming series reads item_name; the form fetches it, but a record made in code may not have it yet
	if not doc.item_name and doc.item_code:
		doc.item_name = frappe.db.get_value("Item", doc.item_code, "item_name")
	if not doc.asset_name:
		doc.asset_name = doc.item_name


def after_insert(doc, method=None):
	# show "Macbook Air M1 - 001" as the Asset Name (the list's title), unless a different name was typed
	if doc.asset_name == doc.item_name and doc.name != doc.asset_name and doc.name.startswith(f"{doc.item_name} - "):
		doc.db_set("asset_name", doc.name, update_modified=False)
