"""Asset naming series, managed from Asset Workspace > Settings (Asset Management Settings > Asset Naming).

The series offered on the Asset form and the default one are property setters on Asset.naming_series, rebuilt from the
Settings (so an update never undoes the choice). Counters are Frappe's standard Series rows:
	.{item_name}. - .###  -> one counter per model, prefix "<Item Name> - "   (Macbook Air M1 - 001)
	ACC-ASS-.YYYY.-       -> one counter, prefix "ACC-ASS-2026-"            (ACC-ASS-2026-00001)
"""

import re

import frappe
from frappe import _
from frappe.custom.doctype.property_setter.property_setter import make_property_setter
from frappe.model.naming import parse_naming_series
from frappe.utils import cint

ITEM_SERIES = ".{item_name}. - .###"
STANDARD_SERIES = "ACC-ASS-.YYYY.-"


def split(value):
	seen, out = set(), []
	for line in (value or "").replace(",", "\n").split("\n"):
		s = line.strip()
		if s and s not in seen:
			seen.add(s)
			out.append(s)
	return out


def validate_series(series):
	if not re.fullmatch(r"[A-Za-z0-9 ._\-/{}#]+", series):
		frappe.throw(_("Naming series {0} may only use letters, numbers, spaces and . - _ / {{ }} #.").format(series))
	if "{" in series and ".{" not in series:
		frappe.throw(_("In {0}, a field must be written as .{{field}}. (e.g. .{{item_name}}.).").format(series))
	for field in re.findall(r"\{(\w+)\}", series):
		if not frappe.get_meta("Asset").has_field(field):
			frappe.throw(_("{0} uses {{{1}}}, which is not an Asset field.").format(series, field))


def current_options():
	"""(options, default) as the Asset form has them now."""
	f = frappe.get_meta("Asset").get_field("naming_series")
	return split(f.options), f.default


def apply(options, default):
	"""Offer these series on the Asset form, with this one as the default."""
	options = split("\n".join(options)) if isinstance(options, list) else split(options)
	if not options:
		frappe.throw(_("Keep at least one naming series."))
	for s in options:
		validate_series(s)
	if default not in options:
		frappe.throw(_("The default series {0} is not in the list.").format(default))
	make_property_setter("Asset", "naming_series", "options", "\n".join(options), "Text", validate_fields_for_doctype=False)
	make_property_setter("Asset", "naming_series", "default", default, "Text", validate_fields_for_doctype=False)
	frappe.clear_cache(doctype="Asset")


def _prefix(series):
	"""The Series counter key a pattern without fields uses today, e.g. ACC-ASS-.YYYY.- -> ACC-ASS-2026-."""
	head = series.split("#", 1)[0].rstrip(".")
	return parse_naming_series(head)


def _digits(series):
	hashes = re.search(r"#+", series)
	return len(hashes.group(0)) if hashes else 5


def _current(prefix):
	return cint(frappe.db.get_value("Series", prefix, "current", order_by="name"))


def counters():
	"""Every series with its counter(s): per model for .{item_name}. series, one for the others."""
	options, default = current_options()
	items = frappe.get_all("Item", filters={"is_fixed_asset": 1}, fields=["name", "item_name"], order_by="item_name")
	out = []
	for series in options:
		digits = _digits(series)
		row = {"series": series, "default": series == default, "per_model": "{item_name}" in series, "counters": []}
		if row["per_model"]:
			for it in items:
				prefix = series.split("#", 1)[0].replace(".{item_name}.", it.item_name).rstrip(".")
				cur = _current(prefix)
				row["counters"].append({"prefix": prefix, "label": it.item_name, "current": cur,
					"next": f"{prefix}{cur + 1:0{digits}d}", "assets": frappe.db.count("Asset", {"name": ("like", f"{prefix}%")})})
		elif "{" not in series:
			prefix = _prefix(series)
			cur = _current(prefix)
			row["counters"].append({"prefix": prefix, "label": prefix, "current": cur, "next": f"{prefix}{cur + 1:0{digits}d}",
				"assets": frappe.db.count("Asset", {"name": ("like", f"{prefix}%")})})
		out.append(row)
	return out


def set_counter(prefix, current):
	"""Set where a series continues from. Lower than an existing asset's number is refused (the next name would clash)."""
	current = cint(current)
	if current < 0:
		frappe.throw(_("The number cannot be negative."))
	highest, highest_name = 0, None
	for name in frappe.get_all("Asset", filters={"name": ("like", f"{prefix}%")}, pluck="name"):
		tail = name[len(prefix):]
		if tail.isdigit() and int(tail) > highest:
			highest, highest_name = int(tail), name
	if current < highest:
		frappe.throw(_("{0} already exists, so the counter can't go below {1}.").format(highest_name, highest))
	if frappe.db.exists("Series", prefix):
		frappe.db.sql("update `tabSeries` set current = %s where name = %s", (current, prefix))
	else:
		frappe.db.sql("insert into `tabSeries` (name, current) values (%s, %s)", (prefix, current))
	return current
