"""Specifications per sub-category, bulk creation, hand-over condition, acknowledgement emails / page, transfers
and history. Everything runs in one transaction rolled back in tearDownClass (queued emails included).
Run: bench --site <site> run-tests --module asset_management.asset_management.tests.test_handover
"""

import email
import unittest

import frappe
from frappe.utils import add_days, nowdate

from asset_management.asset_management import acknowledgement, api, specifications

LOCATION_2 = "AMTEST Branch Office"


def html_of(raw):
	"""The decoded HTML part of a queued email (plus its headers, to check CC)."""
	msg = email.message_from_string(raw)
	html = next((p.get_payload(decode=True).decode() for p in msg.walk() if p.get_content_type() == "text/html"), "")
	return f"CC: {msg.get('CC', '')}\n{html}"


class TestHandover(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		frappe.set_user("Administrator")
		frappe.db._disable_transaction_control = 1
		cls.company = api._default_company()
		# everything the tests need is made here (the site may hold no asset data at all)
		for loc in ("AMTEST Head Office", LOCATION_2):
			frappe.get_doc({"doctype": "Location", "location_name": loc}).insert()
		cls.location = "AMTEST Head Office"
		if not frappe.db.exists("Asset Category Type", "Hardware"):
			frappe.get_doc({"doctype": "Asset Category Type", "type_name": "Hardware", "color": "blue"}).insert()
		category = api.create_category({"category_name": "AMTEST IT Hardware", "category_type": "Hardware", "company": cls.company})
		cls.sub = api.create_sub_category(category, "AMTEST Laptops")
		cls.item = api.create_item({"item_name": "AMTEST Book 14", "category": category, "sub_category": cls.sub})
		cls.emp1, cls.emp2 = (
			api.create_employee({"first_name": f"Amtest{n}", "gender": "Male", "date_of_birth": "1990-01-01",
				"company_email": f"amtest{n}@amtest.example"})["name"]
			for n in (1, 2)
		)
		frappe.db.set_single_value("Asset Management Settings", {"send_acknowledgement": 1, "it_team_emails": "it@amtest.example"})
		frappe.clear_document_cache("Asset Management Settings")
		specifications.save_fields(cls.sub, [
			{"field_label": "RAM", "field_type": "Select", "options": "8GB\n16GB\n32GB", "mandatory": 1},
			{"field_label": "SSD (GB)", "field_type": "Number"},
			{"field_label": "Touch Screen", "field_type": "Yes/No"},
		])

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		frappe.db._disable_transaction_control = 0
		frappe.db.rollback()
		frappe.clear_document_cache("Asset Management Settings")

	def bulk(self, serials, specs=None, submit=1, **extra):
		return api.bulk_create_assets({
			"item_code": self.item, "company": self.company, "location": self.location, "purchase_date": add_days(nowdate(), -30),
			"net_purchase_amount": 55000, "serial_numbers": serials, "specifications": specs or {}, "submit": submit, **extra,
		})

	def emails_for(self, name):
		# matched on the record's link key too: a name can be reused after records are deleted
		key = frappe.db.get_value("Asset Acknowledgement", name, "key")
		return [m for m in frappe.get_all("Email Queue", filters={"reference_doctype": "Asset Acknowledgement", "reference_name": name},
			fields=["name", "message"]) if key in html_of(m.message)]

	def test_specifications_and_bulk_creation(self):
		# fields are per sub-category
		self.assertEqual([f.field_label for f in specifications.fields_of(self.sub)], ["RAM", "SSD (GB)", "Touch Screen"])
		with self.assertRaisesRegex(frappe.ValidationError, "listed twice"):
			self.bulk("AMT-1\nAMT-2\nAMT-1")
		with self.assertRaisesRegex(frappe.ValidationError, "must be one of"):
			self.bulk("AMT-9", {"RAM": "64GB"})
		with self.assertRaisesRegex(frappe.ValidationError, "Fill the specification"):
			self.bulk("AMT-9", {"SSD (GB)": "512"})  # RAM is mandatory to submit
		# pasted from a sheet: commas / new lines; values are normalised
		r = self.bulk("AMT-1, AMT-2\nAMT-3", {"RAM": "16gb", "SSD (GB)": "512", "Touch Screen": "y"})
		self.assertEqual((len(r["assets"]), r["submitted"]), (3, True))
		asset = frappe.get_doc("Asset", r["assets"][0])
		self.assertEqual((asset.docstatus, asset.asset_serial_no, asset.location), (1, "AMT-1", self.location))
		self.assertEqual({s.specification: s.value for s in asset.asset_specifications}, {"RAM": "16GB", "SSD (GB)": "512", "Touch Screen": "Yes"})
		self.assertTrue(asset.name.startswith("AMTEST Book 14 - "))
		with self.assertRaisesRegex(frappe.ValidationError, "Already used"):
			self.bulk("AMT-2")
		# drafts may be incomplete
		draft = self.bulk("AMT-4", {}, submit=0)
		self.assertEqual(frappe.db.get_value("Asset", draft["assets"][0], "docstatus"), 0)

	def test_assign_acknowledge_transfer_return(self):
		a1, a2 = self.bulk("AMT-11\nAMT-12", {"RAM": "8GB"})["assets"]
		# a star rating is required at hand-over
		with self.assertRaisesRegex(frappe.ValidationError, "Rate the condition"):
			api.assign([a1], self.emp1)
		res = api.assign([a1, a2], self.emp1, conditions={a1: {"rating": 5, "notes": "Brand new"}, a2: {"rating": 0.6}})
		self.assertEqual(len(res["acknowledgements"]), 1)  # one acknowledgement per employee and hand-over
		ack = frappe.get_doc("Asset Acknowledgement", res["acknowledgements"][0].name)
		self.assertEqual((ack.status, ack.employee, ack.email, ack.cc, ack.sent_count), ("Pending", self.emp1, "amtest1@amtest.example", "it@amtest.example", 1))
		self.assertEqual({i.asset: round(i.condition_rating * 5) for i in ack.items}, {a1: 5, a2: 3})
		self.assertEqual(frappe.db.get_value("Asset", a1, ["custodian", "acknowledgement_status", "current_acknowledgement"]), (self.emp1, "Pending", ack.name))
		mail = self.emails_for(ack.name)
		self.assertEqual(len(mail), 1)
		body = html_of(mail[0].message)  # the queued email is MIME, quoted-printable
		self.assertIn(f"asset-acknowledgement?key={ack.key}", body)
		self.assertIn("AMT-11", body)
		self.assertIn("CC: it@amtest.example", body)

		# resend while pending
		self.assertEqual(api.resend_acknowledgement(ack.name)["sent_count"], 2)

		# the public page, no login: invalid key, then the real one
		frappe.set_user("Guest")
		try:
			with self.assertRaises(frappe.DoesNotExistError):
				acknowledgement.acknowledge("x" * 40)
			done = acknowledgement.acknowledge(ack.key, remarks="  Charger missing <b>x</b>  ")
		finally:
			frappe.set_user("Administrator")
		ack.reload()
		self.assertEqual((done["status"], ack.status, bool(ack.acknowledged_on)), ("Completed", "Completed", True))
		self.assertEqual(ack.employee_remarks, "Charger missing <b>x</b>")  # stored as typed, trimmed
		self.assertEqual(frappe.db.get_value("Asset", a1, "acknowledgement_status"), "Completed")
		it_mail = frappe.get_all("Email Queue", filters={"reference_name": ack.name, "message": ("like", "%acknowledged receiving%")}, pluck="message")
		self.assertEqual(len(it_mail), 1)
		it_body = html_of(it_mail[0])
		self.assertIn("Charger missing &lt;b&gt;x&lt;/b&gt;", it_body)  # escaped in the IT team's email
		self.assertIn("with remarks", it_body)
		self.assertEqual(api.asset(a1)["acknowledgement"].employee_remarks, "Charger missing <b>x</b>")
		with self.assertRaisesRegex(frappe.ValidationError, "only a Pending"):
			api.resend_acknowledgement(ack.name)

		# a location move keeps the holder (no new acknowledgement)
		later = add_days(nowdate(), 0)
		moved = api.transfer([a1], location=LOCATION_2, transferred_on=later)
		self.assertEqual(moved["acknowledgements"], [])
		self.assertEqual(frappe.db.get_value("Asset", a1, ["custodian", "location", "acknowledgement_status"]), (self.emp1, LOCATION_2, "Completed"))

		# to another employee: condition required, a new acknowledgement for the new holder
		with self.assertRaisesRegex(frappe.ValidationError, "Rate the condition"):
			api.transfer([a1], employee=self.emp2)
		res2 = api.transfer([a1], employee=self.emp2, conditions={a1: {"rating": 0.8}})
		self.assertEqual(frappe.db.get_value("Asset", a1, ["custodian", "acknowledgement_status"]), (self.emp2, "Pending"))
		self.assertEqual(res2["acknowledgements"][0].employee_name, frappe.db.get_value("Employee", self.emp2, "employee_name"))

		# history: who had it, when, where, condition, acknowledgement; plus the event timeline
		d = api.asset(a1)
		hist = d["history"]  # newest first
		self.assertEqual([h["employee"] for h in hist], [self.emp2, self.emp1])
		self.assertEqual((hist[1]["acknowledgement_status"], bool(hist[1]["returned_on"]), round(hist[1]["condition"] * 5)), ("Completed", True, 5))
		self.assertEqual([(t["from"], t["to"]) for t in hist[1]["transfers"]], [(self.location, LOCATION_2)])
		self.assertEqual(hist[0]["location"], LOCATION_2)
		self.assertEqual([e["event"] for e in d["timeline"]][:3], ["Transferred", "Moved", "Assigned"])
		self.assertEqual({s["label"]: s["value"] for s in d["specifications"]}["RAM"], "8GB")

		# return: the asset drops its acknowledgement status
		api.unassign([a1])
		self.assertEqual(frappe.db.get_value("Asset", a1, ["custodian", "acknowledgement_status", "current_acknowledgement"]), ("", None, None))

		# cancelling a hand-over cancels its acknowledgement
		api.unassign([a2])  # a2 is still with emp1
		res3 = api.assign([a2], self.emp2, conditions={a2: {"rating": 4}})
		frappe.get_doc("Asset Movement", res3["movements"][0]).cancel()
		self.assertEqual(frappe.db.get_value("Asset Acknowledgement", res3["acknowledgements"][0].name, "status"), "Cancelled")
		self.assertEqual(frappe.db.get_value("Asset", a2, ["custodian", "acknowledgement_status"]), ("", None))

		# the workspace list
		listing = api.acknowledgements(search="AMT-1")
		self.assertTrue({"Completed", "Pending"} <= set(listing["counts"]))

	def test_quantity_split_and_per_unit_fields(self):
		# RAM is the same for all units; IMEI differs per unit and is mandatory
		specifications.save_fields(self.sub, [
			{"field_label": "RAM", "field_type": "Select", "options": "8GB\n16GB", "mandatory": 1},
			{"field_label": "IMEI", "field_type": "Text", "mandatory": 1, "per_unit": 1},
		])
		try:
			# bulk create with units: per-unit values per serial, shared values once
			with self.assertRaisesRegex(frappe.ValidationError, "enter IMEI"):
				api.bulk_create_assets({"item_code": self.item, "company": self.company, "location": self.location, "purchase_date": nowdate(), "net_purchase_amount": 500,
					"specifications": {"RAM": "8GB"}, "units": [{"serial_no": "AMQ-1", "specifications": {}}], "submit": 1})
			r = api.bulk_create_assets({"item_code": self.item, "company": self.company, "location": self.location, "purchase_date": nowdate(), "net_purchase_amount": 500,
				"specifications": {"RAM": "8GB"}, "submit": 1,
				"units": [{"serial_no": "AMQ-1", "specifications": {"IMEI": "111"}}, {"serial_no": "AMQ-2", "specifications": {"IMEI": "222"}}]})
			specs = {frappe.db.get_value("Asset", a, "asset_serial_no"): {s.specification: s.value for s in frappe.get_doc("Asset", a).asset_specifications}
				for a in r["assets"]}
			self.assertEqual(specs, {"AMQ-1": {"RAM": "8GB", "IMEI": "111"}, "AMQ-2": {"RAM": "8GB", "IMEI": "222"}})

			# an asset saved with quantity 3 can't be submitted; split it into 3 assets
			doc = frappe.get_doc({"doctype": "Asset", "item_code": self.item, "company": self.company, "location": self.location,
				"asset_type": "Existing Asset", "purchase_date": nowdate(), "available_for_use_date": nowdate(), "calculate_depreciation": 0,
				"asset_quantity": 3, "net_purchase_amount": 1000, "asset_serial_no": "AMQ-10"})
			doc.insert()  # saved with the mandatory RAM still blank: it is asked in the split window
			with self.assertRaisesRegex(frappe.ValidationError, "becomes 3 separate assets"):
				frappe.get_doc("Asset", doc.name).submit()
			with self.assertRaisesRegex(frappe.ValidationError, "Already used"):
				specifications.split_asset(doc.name, [{"serial_no": "AMQ-1", "specifications": {"IMEI": "9"}}, {"serial_no": "b", "specifications": {"IMEI": "9"}},
					{"serial_no": "c", "specifications": {"IMEI": "9"}}])
			units = [{"serial_no": f"AMQ-1{n}", "specifications": {"IMEI": f"IM{n}"}} for n in range(3)]
			with self.assertRaisesRegex(frappe.ValidationError, "Enter RAM"):
				specifications.split_asset(doc.name, units)
			res = specifications.split_asset(doc.name, units, shared={"RAM": "16gb"})
			self.assertEqual(len(res["assets"]), 3)
			rows = [frappe.get_doc("Asset", a) for a in res["assets"]]
			self.assertEqual([a.asset_quantity for a in rows], [1, 1, 1])
			self.assertEqual([a.docstatus for a in rows], [1, 1, 1])  # all submitted
			self.assertEqual(sorted(a.asset_serial_no for a in rows), ["AMQ-10", "AMQ-11", "AMQ-12"])
			self.assertAlmostEqual(sum(a.net_purchase_amount for a in rows), 1000, places=2)
			self.assertEqual({a.asset_serial_no: {s.specification: s.value for s in a.asset_specifications}["IMEI"] for a in rows},
				{"AMQ-10": "IM0", "AMQ-11": "IM1", "AMQ-12": "IM2"})
			self.assertTrue(all({s.specification: s.value for s in a.asset_specifications}["RAM"] == "16GB" for a in rows))
			self.assertEqual(len({a.name for a in rows}), 3)
			# copies get their own display name (their ID with the "Item - 001" series, else the model), never the original's
			self.assertTrue(all(a.asset_name in (a.name, a.item_name) and a.asset_name != rows[0].name for a in rows[1:]))
		finally:
			specifications.save_fields(self.sub, [
				{"field_label": "RAM", "field_type": "Select", "options": "8GB\n16GB\n32GB", "mandatory": 1},
				{"field_label": "SSD (GB)", "field_type": "Number"},
				{"field_label": "Touch Screen", "field_type": "Yes/No"},
			])

	def test_settings_page_naming_and_rating(self):
		from asset_management.asset_management import naming

		# series list and default, from the Settings
		api.save_settings({"naming_series_options": ".{item_name}. - .###\nAMT-.YYYY.-.####", "default_naming_series": "AMT-.YYYY.-.####"})
		options, default = naming.current_options()
		self.assertEqual((options, default), ([".{item_name}. - .###", "AMT-.YYYY.-.####"], "AMT-.YYYY.-.####"))
		with self.assertRaisesRegex(frappe.ValidationError, "not an Asset field"):
			api.save_settings({"naming_series_options": ".{nope}. - .###"})
		# new assets follow the default series
		a = self.bulk("AMT-31", {"RAM": "8GB"})["assets"][0]
		year = nowdate()[:4]
		self.assertEqual(a, f"AMT-{year}-0001")
		page = api.settings_page()
		amt = next(s for s in page["series"] if s["series"] == "AMT-.YYYY.-.####")
		self.assertEqual((amt["default"], amt["counters"][0]["current"], amt["counters"][0]["next"]), (True, 1, f"AMT-{year}-0002"))
		# a counter can't go below an existing asset; above is fine
		with self.assertRaisesRegex(frappe.ValidationError, "already exists"):
			api.set_series_counter(f"AMT-{year}-", 0)
		api.set_series_counter(f"AMT-{year}-", 40)
		self.assertEqual(self.bulk("AMT-32", {"RAM": "8GB"})["assets"][0], f"AMT-{year}-0041")
		# condition rating can be made optional
		api.save_settings({"require_condition_rating": 0, "naming_series_options": ".{item_name}. - .###", "default_naming_series": ".{item_name}. - .###"})
		res = api.assign([a], self.emp1)
		self.assertTrue(res["movements"])
		api.save_settings({"require_condition_rating": 1})
		self.assertEqual(naming.current_options()[1], ".{item_name}. - .###")

	def test_create_employee_from_workspace(self):
		with self.assertRaisesRegex(frappe.ValidationError, "not a valid email"):
			api.create_employee({"first_name": "Amtest", "gender": "Female", "date_of_birth": "1995-04-01", "company_email": "nope"})
		for bad in ("98765432101", "98765abc12"):
			with self.assertRaisesRegex(frappe.ValidationError, "at most 10"):
				api.create_employee({"first_name": "Amtest", "gender": "Female", "date_of_birth": "1995-04-01", "cell_number": bad})
		r = api.create_employee({"first_name": "Amtest", "last_name": "Person", "gender": "Female", "date_of_birth": "1995-04-01",
			"company_email": "amtest.person@amtest.example"})
		emp = frappe.get_doc("Employee", r["name"])
		self.assertEqual((emp.employee_name, emp.status, emp.company, emp.prefered_contact_email), ("Amtest Person", "Active", self.company, "Company Email"))
		self.assertEqual(acknowledgement.employee_email(emp.name), "amtest.person@amtest.example")
		self.assertIn(emp.name, [e.name for e in api.employees(search="Amtest")["rows"]])
		# edit from the employee page
		data = api.employee(emp.name)["employee"]
		self.assertTrue(data.can_edit)
		with self.assertRaisesRegex(frappe.ValidationError, "relieving date"):
			api.update_employee(emp.name, {**data, "status": "Left"})
		api.update_employee(emp.name, {**data, "last_name": "Renamed", "personal_email": "amtest.home@amtest.example", "company_email": "",
			"status": "Left", "relieving_date": nowdate()})
		emp.reload()
		self.assertEqual((emp.employee_name, emp.status, emp.prefered_contact_email), ("Amtest Renamed", "Left", "Personal Email"))
		self.assertEqual(acknowledgement.employee_email(emp.name), "amtest.home@amtest.example")

	def test_landing_page_context(self):
		# the module Frappe runs for /asset-acknowledgement (hyphens become underscores)
		from asset_management.www import asset_acknowledgement as page
		a = self.bulk("AMT-21", {"RAM": "32GB"})["assets"][0]
		ack_name = api.assign([a], self.emp1, conditions={a: {"rating": 3}})["acknowledgements"][0].name
		key = frappe.db.get_value("Asset Acknowledgement", ack_name, "key")
		ctx = frappe._dict()
		frappe.form_dict.key = key
		page.get_context(ctx)
		self.assertEqual((ctx.state, ctx.assets[0]["stars"], ctx.assets[0]["serial_no"]), ("pending", 3, "AMT-21"))
		frappe.form_dict.key = "nope"
		ctx = frappe._dict()
		page.get_context(ctx)
		self.assertEqual(ctx.state, "invalid")
		html = frappe.get_doc("Asset Acknowledgement", ack_name)
		self.assertEqual(html.status, "Pending")
