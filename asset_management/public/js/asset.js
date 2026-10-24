// Standard Asset form:
// - the Specifications tab follows the item's sub-category (Item Group > Specification Fields); the server does the
//   same on save (specifications.py), this only shows the rows while the asset is being filled in;
// - one asset per unit: a draft saved with a Quantity above 1 opens a window asking each unit's serial number and
//   its Per Unit specifications, then becomes that many separate assets (specifications.split_asset).
const AM_SPECS = "asset_management.asset_management.specifications.";

frappe.ui.form.on("Asset", {
	item_code(frm) {
		am_sync_specifications(frm);
	},
	refresh(frm) {
		if (frm.doc.item_code && !(frm.doc.asset_specifications || []).length && !frm.is_new()) am_sync_specifications(frm);
		if (am_needs_split(frm)) {
			frm.add_custom_button(__("Split into Units"), () => am_split_dialog(frm)).addClass("btn-primary");
			frm.dashboard.set_headline_alert(
				__("Quantity {0}: each unit becomes its own asset. Use Split into Units to enter the serial numbers.", [frm.doc.asset_quantity]),
				"orange"
			);
		}
	},
	after_save(frm) {
		if (am_needs_split(frm)) am_split_dialog(frm);
	},
});

function am_needs_split(frm) {
	return frm.doc.docstatus === 0 && !frm.is_new() && cint(frm.doc.asset_quantity) > 1 && frm.doc.asset_type !== "Composite Asset";
}

async function am_sync_specifications(frm) {
	if (!frm.doc.item_code) return;
	const { fields } = await frappe.xcall(AM_SPECS + "get_fields", { item_code: frm.doc.item_code });
	if (!fields.length && !(frm.doc.asset_specifications || []).length) return;
	const typed = Object.fromEntries((frm.doc.asset_specifications || []).map((r) => [r.specification, r.value]));
	frm.clear_table("asset_specifications");
	fields.forEach((f) => {
		frm.add_child("asset_specifications", {
			specification: f.field_label,
			value: typed[f.field_label] || "",
			field_type: f.field_type,
			options: f.options,
			mandatory: f.mandatory,
		});
	});
	frm.refresh_field("asset_specifications");
	if (frm.doc.docstatus === 1) frm.dirty();
}

/** A dialog control for a Per Unit specification field. */
function am_unit_control(f, fieldname, columns) {
	const base = { fieldname, label: f.field_label, reqd: f.mandatory ? 1 : 0, in_list_view: 1, columns };
	// a Number stays text (model numbers, long codes; no "0.000" placeholder): the server checks it is a number
	if (f.field_type === "Number") return { ...base, fieldtype: "Data", description: __("Number") };
	if (f.field_type === "Date") return { ...base, fieldtype: "Date" };
	if (f.field_type === "Yes/No") return { ...base, fieldtype: "Select", options: ["", "Yes", "No"] };
	if (f.field_type === "Select") return { ...base, fieldtype: "Select", options: ["", ...String(f.options || "").replace(/,/g, "\n").split("\n").map((o) => o.trim()).filter(Boolean)] };
	return { ...base, fieldtype: "Data" };
}

async function am_split_dialog(frm) {
	const qty = cint(frm.doc.asset_quantity);
	const { fields } = await frappe.xcall(AM_SPECS + "get_fields", { item_code: frm.doc.item_code });
	const perUnit = fields.filter((f) => f.per_unit);
	// specifications common to every unit: asked here too, so the assets can be submitted straight away
	const common = fields.filter((f) => !f.per_unit);
	const typed = Object.fromEntries((frm.doc.asset_specifications || []).map((r) => [r.specification, r.value]));
	const width = Math.max(2, Math.floor(7 / Math.max(perUnit.length, 1)));
	const rows = Array.from({ length: qty }, (_, i) => ({ idx: i + 1, name: `unit-${i + 1}`, serial_no: i === 0 ? frm.doc.asset_serial_no || "" : "" }));
	if (!flt(frm.doc.net_purchase_amount)) {
		frappe.msgprint(__("Enter the Net Purchase Amount and save first: ERPNext needs it to submit the assets."));
		return;
	}
	const d = new frappe.ui.Dialog({
		title: __("{0} units of {1}", [qty, frm.doc.item_name || frm.doc.item_code]),
		size: "extra-large",
		fields: [
			{ fieldtype: "HTML", options: `<p class="text-muted">${__("Each unit becomes its own submitted asset. Enter its serial number{0}. The other details on this form are copied to every unit, and the purchase amount ({1}) is divided between them.",
				[perUnit.length ? __(" and {0}", [perUnit.map((f) => frappe.utils.escape_html(f.field_label)).join(", ")]) : "", format_currency(frm.doc.net_purchase_amount || 0, frm.doc.currency)])}</p>` },
			...(common.length
				? [
					{ fieldtype: "Section Break", label: __("Common to all units") },
					...common.flatMap((f, i) => [
						...(i % 3 === 0 ? [] : [{ fieldtype: "Column Break" }]),
						{ ...am_unit_control(f, `sh_${i}`), in_list_view: 0, default: typed[f.field_label] || "" },
						...((i + 1) % 3 === 0 && i + 1 < common.length ? [{ fieldtype: "Section Break" }] : []),
					]),
					{ fieldtype: "Section Break", label: __("Units") },
				]
				: []),
			{ fieldtype: "Small Text", fieldname: "paste_serials", label: __("Paste serial numbers (optional)"), description: __("One per line or a column from Excel: fills the rows below."),
				onchange: () => {
					const list = String(d.get_value("paste_serials") || "").split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean);
					const grid = d.fields_dict.units;
					list.slice(0, qty).forEach((s, i) => (grid.df.data[i].serial_no = s));
					grid.grid.refresh();
				} },
			{
				fieldtype: "Table", fieldname: "units", label: __("Units"), in_place_edit: true, cannot_add_rows: true, cannot_delete_rows: true, data: rows,
				fields: [
					{ fieldtype: "Data", fieldname: "serial_no", label: __("Serial No"), in_list_view: 1, reqd: 1, columns: 3 },
					...perUnit.map((f, i) => am_unit_control(f, `pu_${i}`, width)),
				],
			},
		],
		primary_action_label: __("Create & Submit {0} Assets", [qty]),
		primary_action: async () => {
			const shared = Object.fromEntries(common.map((f, i) => [f.field_label, d.get_value(`sh_${i}`) ?? ""]));
			const blank = common.filter((f) => f.mandatory && !String(shared[f.field_label] ?? "").trim()).map((f) => f.field_label);
			if (blank.length) return frappe.msgprint(__("Enter {0}.", [blank.join(", ")]));
			const data = d.fields_dict.units.grid.get_data();
			const units = data.map((r) => ({
				serial_no: String(r.serial_no || "").trim(),
				specifications: Object.fromEntries(perUnit.map((f, i) => [f.field_label, r[`pu_${i}`] ?? ""])),
			}));
			const seen = new Set();
			for (const [i, u] of units.entries()) {
				if (!u.serial_no) return frappe.msgprint(__("Row {0}: enter the serial number.", [i + 1]));
				if (seen.has(u.serial_no.toLowerCase())) return frappe.msgprint(__("Serial number {0} is entered twice.", [u.serial_no]));
				seen.add(u.serial_no.toLowerCase());
				const missing = perUnit.filter((f) => f.mandatory && !String(u.specifications[f.field_label] ?? "").trim()).map((f) => f.field_label);
				if (missing.length) return frappe.msgprint(__("Row {0} ({1}): enter {2}.", [i + 1, u.serial_no, missing.join(", ")]));
			}
			d.disable_primary_action();
			try {
				const r = await frappe.xcall(AM_SPECS + "split_asset", { asset: frm.doc.name, units, shared, submit: 1 });
				d.hide();
				frappe.show_alert({ message: __("{0} assets created and submitted: {1}", [r.assets.length, r.assets.join(", ")]), indicator: "green" }, 8);
				frappe.set_route("List", "Asset", { name: ["in", r.assets] });
			} finally {
				d.enable_primary_action();
			}
		},
	});
	d.show();
}
