"""Hand-over acknowledgements.

When a submitted Asset Movement gives assets to an employee who did not hold them (assign, or a transfer to
another employee), one Asset Acknowledgement is made per employee (status Pending) and emailed to them, CC
the IT team (Asset Management Settings). The email links to /asset-acknowledgement?key=..., a public page
(no login) showing the assets and their condition at hand-over, with an Acknowledge button. Acknowledging
sets the record Completed with the time, network address and browser as proof. A Pending one can be resent.
Cancelling the movement cancels its acknowledgements. The Asset shows its current custodian's status.
"""

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, flt, get_url, now_datetime

from asset_management.asset_management.doctype.asset_management_settings.asset_management_settings import split_emails

ACK = "Asset Acknowledgement"
PAGE_ROUTE = "asset-acknowledgement"


def settings():
	return frappe.get_cached_doc("Asset Management Settings")


def enabled():
	# setup.py saves the Settings with acknowledgements on, the first time
	return bool(cint(frappe.db.get_single_value("Asset Management Settings", "send_acknowledgement")))


def employee_email(employee):
	"""The employee's configured email (Employee > preferred email), else company, personal or user email."""
	e = frappe.db.get_value("Employee", employee, ["prefered_email", "company_email", "personal_email", "user_id"], as_dict=True) or {}
	return e.get("prefered_email") or e.get("company_email") or e.get("personal_email") or (
		e.get("user_id") if e.get("user_id") and "@" in e.get("user_id") else None
	)


def link(ack):
	return get_url(f"/{PAGE_ROUTE}?key={ack.key}")


def stars(rating):
	"""Rating fields store 0..1; shown as 0..5 stars."""
	n = round(flt(rating) * 5)
	return "★" * n + "☆" * (5 - n) if n else ""


# ---------------------------------------------------------------- Asset Movement hooks


def on_movement_submit(doc, method=None):
	"""Runs after ERPNext has set the new custodian / location on each asset."""
	if enabled():
		handed = {}
		for d in doc.assets:
			# a new custodian: assign, or a transfer to another employee (a location-only transfer keeps the holder)
			if d.to_employee and d.to_employee != d.from_employee:
				handed.setdefault(d.to_employee, []).append(d)
		for employee, rows in handed.items():
			send(make(doc, employee, rows))
	# returned assets drop their acknowledgement status; kept holders keep theirs
	for d in doc.assets:
		refresh_asset(d.asset)


def make(movement, employee, rows):
	cfg = settings()
	ack = frappe.get_doc({
		"doctype": ACK,
		"status": "Pending",
		"employee": employee,
		"email": employee_email(employee),
		"cc": ", ".join(split_emails(cfg.it_team_emails)) or None,
		"asset_movement": movement.name,
		"movement_purpose": movement.purpose,
		"assigned_on": movement.transaction_date,
		"company": movement.company,
		"key": frappe.generate_hash(length=40),
		"items": [
			{
				"asset": d.asset,
				"asset_name": a.asset_name,
				"item_code": a.item_code,
				"sub_category": a.asset_sub_category,
				"serial_no": a.asset_serial_no,
				"location": d.target_location or a.location,
				"condition_rating": d.get("condition_rating"),
				"condition_notes": d.get("condition_notes"),
			}
			for d in rows
			for a in [frappe.db.get_value("Asset", d.asset, ["asset_name", "item_code", "asset_sub_category", "asset_serial_no", "location"], as_dict=True)]
		],
	})
	ack.insert(ignore_permissions=True)
	return ack


def on_movement_cancel(doc, method=None):
	"""The hand-over did not happen: cancel its acknowledgements and point each asset at its custodian's again."""
	for name in frappe.get_all(ACK, filters={"asset_movement": doc.name, "status": ("!=", "Cancelled")}, pluck="name"):
		frappe.db.set_value(ACK, name, "status", "Cancelled")
		frappe.get_doc(ACK, name).add_comment("Info", _("Cancelled with Asset Movement {0}").format(doc.name))
	for d in doc.assets:
		refresh_asset(d.asset)


def refresh_asset(asset):
	"""The asset's acknowledgement fields from its current custodian's latest (not cancelled) acknowledgement."""
	custodian = frappe.db.get_value("Asset", asset, "custodian")
	latest = None
	if custodian:
		latest = frappe.db.sql(
			f"""select a.name, a.status from `tab{ACK}` a join `tab{ACK} Item` i on i.parent = a.name
			where i.asset = %s and a.employee = %s and a.status != 'Cancelled'
			order by a.assigned_on desc, a.creation desc limit 1""",
			(asset, custodian),
			as_dict=True,
		)
	values = {"acknowledgement_status": latest[0].status, "current_acknowledgement": latest[0].name} if latest else {
		"acknowledgement_status": None, "current_acknowledgement": None}
	frappe.db.set_value("Asset", asset, values, update_modified=False)


# ---------------------------------------------------------------- email


def send(ack, resend=False):
	"""Email the acknowledgement link (CC the IT team). Returns False when the employee has no email."""
	if not ack.email:
		frappe.msgprint(
			_("{0} has no email address on their Employee record, so the acknowledgement for {1} was not emailed. Add one and use Resend, or share the link.").format(
				ack.employee_name or ack.employee, ack.name
			),
			indicator="orange",
			alert=True,
		)
		return False
	cfg = settings()
	frappe.sendmail(
		recipients=[ack.email],
		cc=split_emails(ack.cc),
		subject=_("{0}Please acknowledge: {1} asset(s) handed over to you").format(_("Reminder: ") if resend else "", len(ack.items)),
		message=frappe.render_template("templates/emails/asset_handover_acknowledgement.html", {
			"ack": ack,
			"items": [dict(i.as_dict(), stars=stars(i.condition_rating)) for i in ack.items],
			"link": link(ack),
			"message": cfg.acknowledgement_message,
			"company": ack.company,
			"resend": resend,
		}),
		reference_doctype=ACK,
		reference_name=ack.name,
	)
	now = now_datetime()
	values = {"last_sent_on": now, "sent_count": cint(ack.sent_count) + 1}
	if not ack.sent_on:
		values["sent_on"] = now
	ack.db_set(values, update_modified=False)
	return True


@frappe.whitelist(methods=["POST"])
def resend(name):
	ack = frappe.get_doc(ACK, name)
	ack.check_permission("write")
	if ack.status != "Pending":
		frappe.throw(_("{0} is {1}; only a Pending acknowledgement can be resent.").format(name, ack.status))
	# the employee's email may have been added or changed since
	email = employee_email(ack.employee)
	if email and email != ack.email:
		ack.db_set("email", email, update_modified=False)
	if not send(ack, resend=True):
		frappe.throw(_("{0} has no email address. Add one on the Employee record first.").format(ack.employee_name or ack.employee))
	ack.add_comment("Info", _("Acknowledgement request resent to {0}").format(ack.email))
	return {"email": ack.email, "sent_count": ack.sent_count}


@frappe.whitelist()
def get_link(name):
	"""The acknowledgement page link, to share by other means (chat, printed)."""
	ack = frappe.get_doc(ACK, name)
	ack.check_permission("write")
	return link(ack)


# ---------------------------------------------------------------- the public page (no login)


def by_key(key):
	key = (key or "").strip()
	if len(key) < 20:
		return None
	name = frappe.db.get_value(ACK, {"key": key})
	return frappe.get_doc(ACK, name) if name else None


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=30, seconds=60 * 60)
def acknowledge(key, remarks=None):
	"""The employee confirms receipt from the emailed link, optionally with remarks (e.g. "charger missing")."""
	ack = by_key(key)
	if not ack:
		frappe.throw(_("This acknowledgement link is not valid."), frappe.DoesNotExistError)
	if ack.status == "Cancelled":
		frappe.throw(_("This hand-over was cancelled, so there is nothing to acknowledge."))
	if ack.status == "Completed":
		return {"status": "Completed", "acknowledged_on": str(ack.acknowledged_on)}
	request = getattr(frappe.local, "request", None)
	agent = request.headers.get("User-Agent") if request else None
	ack.db_set({
		"status": "Completed",
		"acknowledged_on": now_datetime(),
		"acknowledged_ip": getattr(frappe.local, "request_ip", None),
		"acknowledged_user_agent": (agent or "")[:500] or None,
		# plain text from a public page: stored as typed, escaped wherever it is shown
		"employee_remarks": (remarks or "").strip()[:2000] or None,
	})
	for row in ack.items:
		if frappe.db.get_value("Asset", row.asset, "current_acknowledgement") == ack.name:
			frappe.db.set_value("Asset", row.asset, "acknowledgement_status", "Completed", update_modified=False)
	ack.add_comment("Info", _("Acknowledged by {0} from {1}{2}").format(
		frappe.utils.escape_html(ack.employee_name or ack.employee), ack.acknowledged_ip or _("an unknown address"),
		_(". Remarks: {0}").format(frappe.utils.escape_html(ack.employee_remarks)) if ack.employee_remarks else "",
	))
	notify_it_team(ack)
	return {"status": "Completed", "acknowledged_on": str(ack.acknowledged_on)}


def notify_it_team(ack):
	"""A short confirmation to the IT team (the CC list of the request)."""
	recipients = split_emails(ack.cc)
	if not recipients:
		return
	rows = "".join(
		f"<li><b>{frappe.utils.escape_html(i.asset_name or i.asset)}</b> ({frappe.utils.escape_html(i.serial_no or '—')}) {stars(i.condition_rating)}</li>"
		for i in ack.items
	)
	remarks = (
		_("<p><b>Remarks from the employee:</b><br>{0}</p>").format(frappe.utils.escape_html(ack.employee_remarks).replace("\n", "<br>"))
		if ack.employee_remarks else ""
	)
	frappe.sendmail(
		recipients=recipients,
		subject=_("Acknowledged{0}: {1} received {2} asset(s)").format(
			_(" with remarks") if ack.employee_remarks else "", ack.employee_name or ack.employee, len(ack.items)
		),
		message=_("<p>{0} acknowledged receiving the following on {1} (reference {2}):</p><ul>{3}</ul>{4}").format(
			frappe.utils.escape_html(ack.employee_name or ack.employee), frappe.utils.format_datetime(ack.acknowledged_on), ack.name, rows, remarks
		),
		reference_doctype=ACK,
		reference_name=ack.name,
	)
