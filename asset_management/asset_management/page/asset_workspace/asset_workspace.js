// Asset Workspace (route /app/asset-workspace/...), built from standard ERPNext desk components: the page head with
// primary / inner buttons, page-form filters, form-style tabs, number cards, frappe-card sections, indicator pills,
// frappe.ui.Dialog with Link / Date controls, frappe.Chart and frappe.DataTable. Server: asset_management/api.py.
// Everything is ERPNext's standard Assets module: Asset Category > Item Group (sub-category) > Item > Asset ("Macbook Air M1 - 001").
// Assets are created on the standard Asset form; assign / return submit a standard Asset Movement (sets the Custodian).

frappe.pages["asset-workspace"].on_page_load = function (wrapper) {
	window.asset_app = new AssetWorkspace(wrapper);
};
frappe.pages["asset-workspace"].on_page_show = function () {
	if (window.asset_app) window.asset_app.show();
};

const AM_ROUTE = "asset-workspace";
const AM_API = "asset_management.asset_management.api.";
const AM_API_REPORTS = "asset_management.asset_management.reports.";
// standard Asset statuses that are not "ready to hand out"
const AM_NOT_AVAILABLE = ["Scrapped", "Sold", "Capitalized", "In Maintenance", "Out of Order"];

// ------------------------------------------------------------------ helpers

const amEsc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
const amInr = (v, d = 0) => format_currency(Number(v || 0), "INR", d);
const amDate = (d) => (d ? moment(String(d).slice(0, 10)).format("DD/MM/YYYY") : "");
/** DD/MM/YYYY with the time below it (none for a movement that only has a date). */
const amDateTime = (d, dateOnly) => (d ? `${amDate(d)}${!dateOnly && String(d).length > 10 ? amMuted(moment(String(d)).format("hh:mm A")) : ""}` : "");
/** "Research & Development - IL" -> "Research & Development" (drop the company abbreviation). */
const amDept = (d) => String(d || "").replace(/\s+-\s+[A-Z0-9]{1,6}$/, "");
const amInitials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

const AM_INDICATOR = {
	Available: "green",
	Assigned: "blue",
	Draft: "red",
	"Under Repair": "orange",
	Disposed: "gray",
	Returned: "gray",
	Hardware: "blue",
	Subscription: "purple",
	Good: "green",
	"Needs Repair": "orange",
	"Lost / Retired": "red",
	"Warranty expired": "red",
	"Warranty ends": "orange",
	Renewal: "purple",
	// hand-over acknowledgement and movement events
	Pending: "orange",
	Completed: "green",
	Cancelled: "gray",
	Received: "gray",
	Transferred: "purple",
	Moved: "cyan",
};
/** A Rating field (0..1) as five stars. */
const amStars = (v) => {
	const n = Math.round(Number(v || 0) * 5);
	return n ? `<span class="am-stars" title="${__("Condition {0} of 5", [n])}">${"★".repeat(n)}<span class="am-stars-off">${"★".repeat(5 - n)}</span></span>` : `<span class="text-muted">—</span>`;
};
/** Acknowledgement status of a hand-over, e.g. "Ack: Pending". */
const amAck = (status) => (status ? amPill(__("Ack: {0}", [__(status)]), AM_INDICATOR[status]) : "");

/** A dialog control for a Specification Field (Text / Number / Select / Yes/No / Date). */
const amSpecControl = (f, fieldname, extra = {}) => {
	const base = { fieldname, label: f.field_label, reqd: f.mandatory ? 1 : 0, ...extra };
	if (f.field_type === "Number") return { ...base, fieldtype: "Data" };  // text, checked as a number on the server (no "0.000")
	if (f.field_type === "Date") return { ...base, fieldtype: "Date" };
	if (f.field_type === "Yes/No") return { ...base, fieldtype: "Select", options: ["", "Yes", "No"] };
	if (f.field_type === "Select") return { ...base, fieldtype: "Select", options: ["", ...String(f.options || "").replace(/,/g, "\n").split("\n").map((o) => o.trim()).filter(Boolean)] };
	return { ...base, fieldtype: "Data" };
};

/** The "Units" table: a row per asset with its serial number and the Per Unit specification fields. */
const amUnitsTable = (perUnit, serialLabel) => {
	const width = Math.max(2, Math.floor(7 / Math.max(perUnit.length, 1)));
	return {
		fieldtype: "Table", fieldname: "units", label: __("Units"), in_place_edit: true, cannot_add_rows: true, cannot_delete_rows: true, data: [],
		fields: [
			{ fieldtype: "Data", fieldname: "serial_no", label: serialLabel, in_list_view: 1, reqd: 1, columns: 3 },
			...perUnit.map((f, i) => amSpecControl(f, `pu_${i}`, { in_list_view: 1, columns: width })),
		],
	};
};

/** Make the Units table n rows long (keeping what is typed); `serials` fills the serial numbers in order. */
const amResizeUnits = (field, n, serials = null) => {
	const data = (field.df.data || []).slice(0, Math.max(n || 0, 0));
	while (data.length < n) data.push({});
	data.forEach((row, i) => {
		row.idx = i + 1;
		row.name = row.name || `unit-${i + 1}`;
		if (serials && serials[i]) row.serial_no = serials[i];
	});
	field.df.data = data;
	field.grid.refresh();
};

/** [{serial_no, specifications: {label: value}}] from the Units table rows. */
const amUnitsFromRows = (rows, perUnit) => (rows || []).map((r) => ({
	serial_no: String(r.serial_no || "").trim(),
	specifications: Object.fromEntries(perUnit.map((f, i) => [f.field_label, r[`pu_${i}`] ?? ""])),
}));

/** The first problem in the units (missing / repeated serial, missing mandatory value), or "". */
const amCheckUnits = (units, perUnit, serialLabel) => {
	if (!units.length) return __("Enter the quantity.");
	const seen = new Set();
	for (const [i, u] of units.entries()) {
		if (!u.serial_no) return __("Row {0}: enter the {1}.", [i + 1, serialLabel]);
		const key = u.serial_no.toLowerCase();
		if (seen.has(key)) return __("{0} {1} is entered twice.", [serialLabel, u.serial_no]);
		seen.add(key);
		const missing = perUnit.filter((f) => f.mandatory && !String(u.specifications[f.field_label] ?? "").trim()).map((f) => f.field_label);
		if (missing.length) return __("Row {0} ({1}): enter {2}.", [i + 1, u.serial_no, missing.join(", ")]);
	}
	return "";
};
const AM_STATUSES = ["Available", "Assigned", "Draft", "Under Repair", "Disposed"];
/** Category Types (Asset Category Type master) carry their own tag colour. */
const amSetTypeColours = (types) => types.forEach((t) => {
	if (!AM_STATUSES.includes(t.name)) AM_INDICATOR[t.name] = t.color || "gray";
});
const amPill = (text, colour) => (text ? `<span class="indicator-pill ${colour || AM_INDICATOR[text] || "gray"} no-indicator-dot">${amEsc(text)}</span>` : "");
const amMuted = (text) => `<div class="text-muted small">${amEsc(text)}</div>`;
/** "IT Hardware › Laptop" under an asset. */
const amPath = (r) => amMuted([r.category, r.sub_category].filter(Boolean).join(" › "));
const amLink = (go, text) => `<a href="#" data-go="${amEsc(go)}">${amEsc(text)}</a>`;
const amEmpty = (text) => `<div class="am-empty text-muted">${amEsc(text)}</div>`;

const AM_TABS = [
	["", __("Dashboard")],
	["assign", __("Assign & Return")],
	["employees", __("Employees")],
	["assets", __("Assets")],
	["acknowledgements", __("Acknowledgements")],
	["reports", __("Reports")],
	["catalogue", __("Catalogue")],
	["settings", __("Settings")],
];

// Layout only; colours come from the desk theme variables so light and dark mode both work.
const AM_CSS = `
	.am-tabs { margin: 0 0 var(--margin-md); }
	.am-tabs .form-tabs { border-bottom: 1px solid var(--border-color); }
	.am-body { padding: 0 var(--padding-md) var(--padding-xl); }
	.page-form .frappe-control[data-fieldname="report"] { min-width: 230px; }
	.page-form .frappe-control[data-fieldname="report"] select { width: 100% !important; }
	.am-share { display: flex; align-items: center; gap: 6px; }
	.am-share .progress { flex: 1; height: 6px; margin: 0; min-width: 40px; }
	.am-number-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: var(--margin-md); margin-bottom: var(--margin-md); }
	.am-number-cards .number-widget-box { margin: 0; min-height: 92px; }
	.am-number-cards .number-widget-box.am-click { cursor: pointer; }
	.am-number-cards .number-widget-box.am-click:hover { border-color: var(--gray-400); }
	.am-number-cards .number-widget-box.am-on { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
	.am-number-cards .widget-content .number { font-size: var(--text-2xl); font-weight: var(--weight-semibold); }
	.am-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: var(--margin-md); margin-bottom: var(--margin-md); }
	.am-grid > .frappe-card, .am-body > .frappe-card { margin-bottom: 0; }
	.am-body > .frappe-card + .frappe-card, .am-body > .am-grid + .frappe-card, .am-body > .frappe-card + .am-grid { margin-top: var(--margin-md); }
	.am-card { padding: var(--padding-md) var(--padding-lg); }
	.am-card-head { display: flex; justify-content: space-between; align-items: center; gap: var(--margin-sm); margin-bottom: var(--margin-sm); min-height: 28px; }
	.am-card-head h5 { margin: 0; font-size: var(--text-base); font-weight: var(--weight-semibold); }
	.am-card-head .am-count { color: var(--text-muted); font-weight: var(--weight-regular); margin-left: 4px; }
	.am-card-head .am-actions { display: flex; gap: var(--margin-xs); flex-wrap: wrap; justify-content: flex-end; }
	.am-table { margin: 0; }
	.am-table th { color: var(--text-muted); font-weight: var(--weight-medium); font-size: var(--text-sm); white-space: nowrap; border-top: 0 !important; }
	.am-table td { vertical-align: middle !important; }
	.am-table .text-right { white-space: nowrap; }
	.am-table tr[data-go] { cursor: pointer; }
	.am-table .am-ck { width: 28px; }
	.am-scroll { max-height: calc(100vh - 340px); overflow: auto; }
	.am-scroll thead th { position: sticky; top: 0; background: var(--card-bg); z-index: 1; }
	.am-empty { padding: var(--padding-lg) 0; text-align: center; }
	.am-who { display: flex; align-items: center; gap: var(--margin-sm); min-width: 0; }
	.am-tags { display: flex; flex-wrap: wrap; gap: 4px; }
	.am-sub { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px var(--margin-sm); align-items: center; margin-top: var(--margin-sm); font-size: var(--text-sm); }
	.am-sub .progress { grid-column: 1 / -1; height: 6px; margin: 0; }
	.am-cat-card { cursor: pointer; }
	.am-cat-card:hover { border-color: var(--gray-400); }
	.am-cat-total { font-size: var(--text-2xl); font-weight: var(--weight-semibold); line-height: 1.2; }
	.am-kv { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--margin-sm) var(--margin-md); }
	.am-kv .frappe-control { margin: 0; }
	.am-kv .control-value { min-height: 30px; }
	.am-activity { list-style: none; margin: 0; padding: 0; }
	.am-activity li { display: flex; gap: var(--margin-sm); padding: var(--padding-sm) 0; border-bottom: 1px solid var(--border-color); cursor: pointer; }
	.am-activity li:last-child { border-bottom: 0; }
	.am-activity .indicator { margin-top: 6px; }
	.am-sub-head { display: flex; justify-content: space-between; align-items: center; gap: var(--margin-sm); padding: var(--padding-sm) 0; margin-top: var(--margin-sm); border-top: 1px solid var(--border-color); }
	.am-sub-head:first-of-type { border-top: 0; margin-top: 0; }
	.am-report-chart { min-height: 260px; }
	.am-days-late { color: var(--red-600); } .am-days-near { color: var(--orange-600); }
	.am-stars { color: var(--yellow-500, #f59e0b); letter-spacing: 1px; white-space: nowrap; font-size: var(--text-md); }
	.am-stars-off { color: var(--gray-300); }
	.am-spec-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--margin-sm) var(--margin-md); }
	.am-spec-grid .label { color: var(--text-muted); font-size: var(--text-sm); }
	.am-spec-grid .value { font-weight: var(--weight-medium); }
	.am-serial-count { margin-top: -6px; }
	.am-moves { font-size: var(--text-sm); }
`;

// ------------------------------------------------------------------ app

class AssetWorkspace {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({ parent: wrapper, title: __("Asset Workspace"), single_column: true });
		frappe.dom.set_style(AM_CSS, "asset-workspace-css");
		this.$tabs = $(`<div class="form-tabs-list am-tabs"><ul class="nav form-tabs" role="tablist">
			${AM_TABS.map(([r, l]) => `<li class="nav-item"><a class="nav-link" href="#" data-go="${r}" data-tab="${r}">${l}</a></li>`).join("")}
		</ul></div>`).prependTo(this.page.main);
		this.$body = $('<div class="am-body"></div>').appendTo(this.page.main);
		// one click handler for every in-page link: data-go="sub|name" navigates inside the workspace
		$(this.page.main).on("click", "[data-go]", (e) => {
			if ($(e.target).closest("button, input, .am-no-go").length) return;
			e.preventDefault();
			this.go(...String($(e.currentTarget).attr("data-go")).split("|"));
		});
		this.ready = frappe.xcall(AM_API + "boot").then((b) => {
			this.boot = b;
			amSetTypeColours(Object.entries(b.category_types || {}).map(([name, t]) => ({ name, color: t.color })));
		});
	}

	go(...parts) {
		frappe.set_route(AM_ROUTE, ...parts.filter((p) => p !== undefined && p !== null && p !== ""));
	}

	/** Reset the page head, filters and body before a view draws itself. */
	reset() {
		const p = this.page;
		p.clear_primary_action();
		p.clear_secondary_action();
		p.clear_inner_toolbar();
		p.clear_menu();
		p.clear_indicator();
		p.clear_fields();
		p.fields_dict = {};
		p.hide_form();
		p.add_menu_item(__("Asset List"), () => frappe.set_route("List", "Asset"));
		p.add_menu_item(__("Asset Movement List"), () => frappe.set_route("List", "Asset Movement"));
		p.add_menu_item(__("Employee List"), () => frappe.set_route("List", "Employee"));
		p.add_menu_item(__("Asset Acknowledgement List"), () => frappe.set_route("List", "Asset Acknowledgement"));
		p.add_menu_item(__("Settings"), () => this.go("settings"));
		p.add_menu_item(__("User Guide"), () => window.open("/assets/asset_management/guide/asset-module-guide.html", "_blank"));
		this.$body.html(`<div class="am-empty text-muted">${__("Loading…")}</div>`);
	}

	async show() {
		try {
			await this.ready;
		} catch (err) {
			this.$body.html(amEmpty(__("Could not load the Asset Workspace.")));
			return;
		}
		const [, sub = "", name] = frappe.get_route();
		const tab = { employee: "employees", asset: "assets" }[sub] ?? sub;
		this.$tabs.find(".nav-link").each((_, a) => a.classList.toggle("active", a.dataset.tab === tab));
		const views = {
			"": AmDashboardView,
			assign: AmAssignView,
			employees: AmEmployeesView,
			employee: AmEmployeeView,
			assets: AmAssetsView,
			asset: AmAssetView,
			reports: AmReportsView,
			catalogue: AmCatalogueView,
			acknowledgements: AmAcksView,
			settings: AmSettingsView,
		};
		const View = views[sub] || AmDashboardView;
		this.reset();
		const token = (this.token = Symbol());
		this.view = new View(this, name);
		try {
			await this.view.render(token);
		} catch (err) {
			if (this.token === token) this.$body.html(amEmpty(err.message || __("Something went wrong.")));
		}
	}

	stale(token) {
		return this.token !== token;
	}

	/** Re-render the current view in place (after an assign, return or edit). */
	refresh() {
		if (this.view) this.view.render((this.token = Symbol()));
	}

	api(method, args = {}) {
		return frappe.xcall(method.includes(".") ? method : AM_API + method, args);
	}

	// -------------------------------------------------------------- shared dialogs

	/** Star rating + notes for each asset handed over (Asset Movement Item > Condition at Hand-over). */
	conditionFields(assets, dependsOn = null) {
		const required = this.boot.require_rating !== false;  // Settings > Condition Rating Required at Hand-over
		const fields = [{ fieldtype: "Section Break", label: __("Condition at Hand-over"), depends_on: dependsOn,
			description: __("Rate each asset as it is handed over (5 = like new). The employee sees it in the acknowledgement.") }];
		assets.forEach((a, i) => {
			fields.push(
				{ fieldtype: "Rating", fieldname: `rating_${i}`, label: assets.length > 1 || !a ? __("Condition: {0}", [a || __("asset")]) : __("Condition"),
					reqd: required && !dependsOn ? 1 : 0, mandatory_depends_on: required ? dependsOn : null, default: 0 },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Data", fieldname: `notes_${i}`, label: __("Notes"), placeholder: __("e.g. small scratch on lid, charger included") },
				{ fieldtype: "Section Break", depends_on: dependsOn, hide_border: 1 },
			);
		});
		return fields;
	}

	/** {asset: {rating, notes}} from the condition fields. */
	conditionValues(assets, v) {
		return Object.fromEntries(assets.map((a, i) => [a, { rating: v[`rating_${i}`] || 0, notes: v[`notes_${i}`] || "" }]));
	}

	/** Where the acknowledgement email will go, under the employee field. */
	async ackHint(d, employee) {
		const box = d.get_field("ack_hint");
		if (!box) return;
		if (!this.boot.ack_enabled) return box.$wrapper.html(`<p class="text-muted small">${__("Acknowledgement emails are off (Acknowledgement Settings).")}</p>`);
		if (!employee) return box.$wrapper.html("");
		const e = (await frappe.db.get_value("Employee", employee, ["prefered_email", "company_email", "personal_email"])).message || {};
		const email = e.prefered_email || e.company_email || e.personal_email;
		box.$wrapper.html(email
			? `<p class="text-muted small">${__("An acknowledgement link will be emailed to {0} (CC the IT team).", [`<b>${amEsc(email)}</b>`])}</p>`
			: `<p class="small" style="color:var(--orange-600)">${__("This employee has no email address, so no acknowledgement email can be sent. Add one on the Employee record, or share the link from Acknowledgements.")}</p>`);
	}

	/** Assign one or more assets to an employee: a standard Asset Movement (Issue) with the condition at hand-over;
	 * the employee is emailed an acknowledgement link. Pass `employee` to fix the employee. */
	assignDialog({ assets = [], employee = "", onDone } = {}) {
		const fields = [];
		if (assets.length) {
			fields.push({ fieldtype: "HTML", fieldname: "assets_html", options: `<div class="form-group"><label class="control-label">${assets.length === 1 ? __("Asset") : __("{0} assets", [assets.length])}</label><div class="am-tags">${assets.map((a) => amPill(a, "blue")).join("")}</div></div>` });
		} else {
			fields.push({
				fieldtype: "Link", fieldname: "asset", label: __("Asset"), options: "Asset", reqd: 1,
				description: __("Submitted assets that nobody holds"),
				get_query: () => ({ filters: [["Asset", "docstatus", "=", 1], ["Asset", "custodian", "is", "not set"], ["Asset", "status", "not in", AM_NOT_AVAILABLE]] }),
			});
		}
		fields.push(
			{ fieldtype: "Link", fieldname: "employee", label: __("Employee"), options: "Employee", reqd: 1, default: employee,
				get_query: () => ({ filters: { status: "Active" } }), onchange: () => this.ackHint(d, d.get_value("employee")) },
			{ fieldtype: "HTML", fieldname: "ack_hint" },
			{ fieldtype: "Datetime", fieldname: "assigned_on", label: __("Assigned On"), reqd: 1, default: frappe.datetime.now_datetime() },
			...this.conditionFields(assets.length ? assets : [""]),
			{ fieldtype: "Section Break" },
			{ fieldtype: "HTML", fieldname: "note", options: `<p class="text-muted small">${__("Creates and submits a standard Asset Movement (Issue), which sets the asset's Custodian.")}</p>` },
		);
		const d = new frappe.ui.Dialog({
			title: assets.length > 1 ? __("Assign {0} Assets", [assets.length]) : __("Assign Asset"),
			size: assets.length > 1 ? "large" : undefined,
			fields,
			primary_action_label: __("Assign"),
			primary_action: async (v) => {
				const names = assets.length ? assets : [v.asset];
				d.disable_primary_action();
				try {
					const r = await this.api("assign", { assets: names, employee: v.employee, assigned_on: v.assigned_on, conditions: this.conditionValues(names, v) });
					d.hide();
					const sent = (r.acknowledgements || []).filter((a) => a.email).length;
					frappe.show_alert({ message: __("{0} assigned to {1} ({2}){3}", [names.length === 1 ? names[0] : __("{0} assets", [names.length]), r.employee_name || v.employee, r.movements.join(", "), sent ? " · " + __("acknowledgement email sent") : ""]), indicator: "green" }, 7);
					(onDone || (() => this.refresh()))();
				} finally {
					d.enable_primary_action();
				}
			},
		});
		d.show();
		if (employee) this.ackHint(d, employee);
		else this.ackHint(d, "");
	}

	/** Move assets to another employee and / or location (standard Asset Movements); the history is kept. */
	transferDialog({ assets, holder, onDone }) {
		const d = new frappe.ui.Dialog({
			title: assets.length > 1 ? __("Transfer {0} Assets", [assets.length]) : __("Transfer Asset"),
			size: assets.length > 1 ? "large" : undefined,
			fields: [
				{ fieldtype: "HTML", fieldname: "assets_html", options: `<div class="form-group"><label class="control-label">${assets.length === 1 ? __("Asset") : __("{0} assets", [assets.length])}${holder ? " " + __("now with {0}", [amEsc(holder)]) : ""}</label><div class="am-tags">${assets.map((a) => amPill(a, "blue")).join("")}</div></div>` },
				{ fieldtype: "Link", fieldname: "employee", label: __("To Employee"), options: "Employee", get_query: () => ({ filters: { status: "Active" } }),
					description: __("Leave blank to keep the current holder."), onchange: () => this.ackHint(d, d.get_value("employee")) },
				{ fieldtype: "HTML", fieldname: "ack_hint" },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Link", fieldname: "location", label: __("To Location"), options: "Location", description: __("Leave blank to keep the location.") },
				{ fieldtype: "Datetime", fieldname: "transferred_on", label: __("Transferred On"), reqd: 1, default: frappe.datetime.now_datetime() },
				...this.conditionFields(assets, "eval:doc.employee"),
				{ fieldtype: "Section Break" },
				{ fieldtype: "HTML", fieldname: "note", options: `<p class="text-muted small">${__("A standard Asset Movement: to another employee it is an Issue (or Transfer and Issue with a new location) and the new holder is emailed an acknowledgement; a location move keeps the holder.")}</p>` },
			],
			primary_action_label: __("Transfer"),
			primary_action: async (v) => {
				if (!v.employee && !v.location) return frappe.msgprint(__("Choose the employee and / or the location to transfer to."));
				d.disable_primary_action();
				try {
					const r = await this.api("transfer", { assets, employee: v.employee || null, location: v.location || null, transferred_on: v.transferred_on,
						conditions: v.employee ? this.conditionValues(assets, v) : null });
					d.hide();
					frappe.show_alert({ message: __("Transferred ({0}){1}", [r.movements.join(", "), (r.acknowledgements || []).length ? " · " + __("acknowledgement email sent") : ""]), indicator: "green" }, 7);
					(onDone || (() => this.refresh()))();
				} finally {
					d.enable_primary_action();
				}
			},
		});
		d.show();
	}

	/** Create many assets of one model that differ only by serial number. Without an item, asks for it first. */
	async bulkCreateDialog(itemCode, onDone) {
		if (!itemCode) {
			const pick = new frappe.ui.Dialog({
				title: __("Bulk Create Assets"),
				fields: [{ fieldtype: "Link", fieldname: "item_code", label: __("Model (Fixed Asset Item)"), options: "Item", reqd: 1,
					get_query: () => ({ filters: { is_fixed_asset: 1, disabled: 0 } }), description: __("Every asset will be this model, with the same configuration.") }],
				primary_action_label: __("Next"),
				primary_action: (v) => {
					pick.hide();
					this.bulkCreateDialog(v.item_code, onDone);
				},
			});
			return pick.show();
		}
		const [item, specs] = await Promise.all([
			frappe.db.get_value("Item", itemCode, ["item_name", "item_group", "asset_category"]).then((r) => r.message || {}),
			frappe.xcall("asset_management.asset_management.specifications.get_fields", { item_code: itemCode }),
		]);
		const typeName = (this.boot.categories.find((c) => c.name === item.asset_category) || {}).category_type;
		const isSub = !!((this.boot.category_types || {})[typeName] || {}).is_subscription;
		// fields the same for every unit vs. fields asked for each unit (Settings > Specification Fields > Per Unit)
		const shared = specs.fields.filter((f) => !f.per_unit);
		const perUnit = specs.fields.filter((f) => f.per_unit);
		const specFields = shared.map((f, i) => amSpecControl(f, `spec_${i}`));
		const serialLabel = isSub ? __("Licence / Account ID") : __("Serial No");
		const countSerials = (text) => String(text || "").split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean);
		const unitsMode = perUnit.length > 0;
		const d = new frappe.ui.Dialog({
			title: __("Bulk Create: {0}", [item.item_name || itemCode]),
			size: "extra-large",
			fields: [
				{ fieldtype: "HTML", fieldname: "model", options: `<p class="text-muted">${__("{0} · {1} · {2}. One asset is created per unit, all with the details below.", [amEsc(item.item_name || itemCode), amEsc(item.item_group || ""), amEsc(item.asset_category || "")])}</p>` },
				{ fieldtype: "Section Break", label: __("Purchase") },
				{ fieldtype: "Link", fieldname: "company", label: __("Company"), options: "Company", reqd: 1, default: this.boot.company },
				{ fieldtype: "Link", fieldname: "location", label: __("Location"), options: "Location", reqd: 1, default: this.boot.default_location },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Date", fieldname: "purchase_date", label: isSub ? __("Start Date") : __("Purchase Date"), reqd: 1, default: this.boot.today },
				{ fieldtype: "Currency", fieldname: "net_purchase_amount", label: isSub ? __("Cost per Licence") : __("Cost per Asset"), reqd: 1,
					description: __("ERPNext needs a purchase amount to submit an asset.") },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Date", fieldname: "warranty_renewal_date", label: isSub ? __("Renewal Date") : __("Warranty Until") },
				...(isSub ? [{ fieldtype: "Select", fieldname: "billing_cycle", label: __("Billing Cycle"), options: ["", "Monthly", "Yearly"] }] : []),
				...(specFields.length ? [{ fieldtype: "Section Break", label: __("Specifications (same for every unit)") }, ...specFields.flatMap((f, i) => (i && i % 3 === 0 ? [{ fieldtype: "Section Break", hide_border: 1 }, f] : i ? [{ fieldtype: "Column Break" }, f] : [f]))] : []),
				...(unitsMode
					? [
						{ fieldtype: "Section Break", label: __("Units"), description: __("One row per asset: its {0} and {1}.", [serialLabel, perUnit.map((f) => f.field_label).join(", ")]) },
						{ fieldtype: "Int", fieldname: "quantity", label: __("Quantity"), reqd: 1, default: 1, onchange: () => resize(d.get_value("quantity")) },
						{ fieldtype: "Column Break" },
						{ fieldtype: "Small Text", fieldname: "paste_serials", label: __("Paste {0}s (optional)", [serialLabel]),
							description: __("One per line or a column from Excel: fills the rows below."), onchange: () => pasteSerials() },
						{ fieldtype: "Section Break", hide_border: 1 },
						amUnitsTable(perUnit, serialLabel),
					]
					: [
						{ fieldtype: "Section Break", label: isSub ? __("Licence / Account IDs") : __("Serial Numbers") },
						{ fieldtype: "Small Text", fieldname: "serial_numbers", label: isSub ? __("Licence / Account IDs") : __("Serial Numbers"), reqd: 1,
							description: __("One per line, or paste a column from Excel. Commas also work."), onchange: () => paintCount() },
						{ fieldtype: "HTML", fieldname: "serial_count" },
					]),
				{ fieldtype: "Section Break", hide_border: 1 },
				{ fieldtype: "Check", fieldname: "submit", label: __("Submit the assets (ready to assign)"), default: 1 },
			],
			primary_action_label: __("Create Assets"),
			primary_action: async (v) => {
				const specifications = Object.fromEntries(shared.map((f, i) => [f.field_label, v[`spec_${i}`] ?? ""]));
				const payload = { item_code: itemCode, company: v.company, location: v.location, purchase_date: v.purchase_date,
					net_purchase_amount: v.net_purchase_amount, warranty_renewal_date: v.warranty_renewal_date, billing_cycle: v.billing_cycle,
					submit: v.submit, specifications };
				if (unitsMode) {
					const units = amUnitsFromRows(d.fields_dict.units.grid.get_data ? d.fields_dict.units.grid.get_data() : v.units, perUnit);
					const problem = amCheckUnits(units, perUnit, serialLabel);
					if (problem) return frappe.msgprint(problem);
					payload.units = units;
				} else {
					const serials = countSerials(v.serial_numbers);
					if (!serials.length) return frappe.msgprint(__("Enter at least one serial number."));
					payload.serial_numbers = serials.join("\n");
				}
				d.disable_primary_action();
				try {
					const r = await this.api("bulk_create_assets", { data: payload });
					d.hide();
					frappe.show_alert({ message: __("{0} assets created{1}", [r.assets.length, r.submitted ? "" : " " + __("as drafts")]), indicator: "green" }, 7);
					(onDone || (() => {
						// show the new assets in the register
						this._assetFilters = { search: item.item_name || itemCode, category: "", sub_category: "", status: "" };
						if (frappe.get_route()[1] === "assets") this.show();
						else this.go("assets");
					}))(r);
				} finally {
					d.enable_primary_action();
				}
			},
		});
		const paintCount = () => {
			const list = countSerials(d.get_value("serial_numbers"));
			const dupes = list.filter((s, i) => list.findIndex((x) => x.toLowerCase() === s.toLowerCase()) !== i);
			d.get_field("serial_count").$wrapper.html(list.length
				? `<p class="small am-serial-count ${dupes.length ? "text-danger" : "text-muted"}">${dupes.length ? __("Listed twice: {0}", [amEsc([...new Set(dupes)].join(", "))]) : __("{0} asset(s) will be created.", [list.length])}</p>` : "");
			d.set_primary_action(list.length ? __("Create {0} Assets", [list.length]) : __("Create Assets"));
		};
		const resize = (n) => {
			amResizeUnits(d.fields_dict.units, n);
			d.set_primary_action(n > 0 ? __("Create {0} Assets", [n]) : __("Create Assets"));
		};
		const pasteSerials = () => {
			const list = countSerials(d.get_value("paste_serials"));
			if (!list.length) return;
			if (list.length > (d.get_value("quantity") || 0)) d.set_value("quantity", list.length);
			amResizeUnits(d.fields_dict.units, Math.max(list.length, d.get_value("quantity") || 0), list);
			d.set_primary_action(__("Create {0} Assets", [d.fields_dict.units.df.data.length]));
		};
		d.show();
		if (unitsMode) resize(1);
		else d.fields_dict.serial_numbers.$input.on("input", frappe.utils.debounce(paintCount, 200));
	}

	/** New or edit a standard Employee (ERPNext's required fields plus the email acknowledgements go to).
	 * Pass `employee` (values from api.employee) to edit it. */
	employeeDialog({ employee = null, onDone } = {}) {
		const editing = !!employee;
		const d = new frappe.ui.Dialog({
			title: editing ? __("Edit Employee: {0}", [employee.employee_name]) : __("New Employee"),
			size: "large",
			fields: [
				{ fieldtype: "Data", fieldname: "first_name", label: __("First Name"), reqd: 1 },
				{ fieldtype: "Data", fieldname: "last_name", label: __("Last Name") },
				{ fieldtype: "Link", fieldname: "gender", label: __("Gender"), options: "Gender", reqd: 1 },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Date", fieldname: "date_of_birth", label: __("Date of Birth"), reqd: 1 },
				{ fieldtype: "Date", fieldname: "date_of_joining", label: __("Date of Joining"), reqd: 1, default: this.boot.today },
				{ fieldtype: "Data", fieldname: "cell_number", label: __("Mobile"), length: 10, description: __("Digits only, up to 10.") },
				{ fieldtype: "Section Break", label: __("Work") },
				{ fieldtype: "Link", fieldname: "company", label: __("Company"), options: "Company", reqd: 1, default: this.boot.company },
				{ fieldtype: "Link", fieldname: "department", label: __("Department"), options: "Department",
					get_query: () => ({ filters: { company: d.get_value("company"), is_group: 0 } }) },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Link", fieldname: "designation", label: __("Designation"), options: "Designation" },
				...(editing ? [
					{ fieldtype: "Select", fieldname: "status", label: __("Status"), options: ["Active", "Inactive", "Suspended", "Left"], reqd: 1,
						description: __("Left / Inactive employees are hidden when assigning assets.") },
					{ fieldtype: "Date", fieldname: "relieving_date", label: __("Relieving Date"),
						depends_on: "eval:doc.status=='Left'", mandatory_depends_on: "eval:doc.status=='Left'" },
				] : []),
				{ fieldtype: "Section Break", label: __("Email"), description: __("Asset hand-over acknowledgements are sent here (company email first).") },
				{ fieldtype: "Data", fieldname: "company_email", label: __("Company Email"), options: "Email" },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Data", fieldname: "personal_email", label: __("Personal Email"), options: "Email" },
			],
			primary_action_label: editing ? __("Save") : __("Create Employee"),
			primary_action: async (v) => {
				if (v.cell_number && !/^\d{1,10}$/.test(v.cell_number)) return frappe.msgprint(__("Mobile number must be digits only, at most 10."));
				if (!v.company_email && !v.personal_email) {
					const go = await new Promise((resolve) => frappe.confirm(
						__("No email address: this employee won't receive asset acknowledgement emails. Continue?"), () => resolve(true), () => resolve(false)));
					if (!go) return;
				}
				d.disable_primary_action();
				try {
					const r = editing
						? await this.api("update_employee", { name: employee.name, data: v })
						: await this.api("create_employee", { data: v });
					d.hide();
					frappe.show_alert({ message: editing ? __("{0} saved", [r.employee_name]) : __("Employee {0} ({1}) created", [r.employee_name, r.name]), indicator: "green" }, 6);
					onDone && onDone(r);
				} finally {
					d.enable_primary_action();
				}
			},
		});
		if (editing) {
			const values = {};
			["first_name", "last_name", "gender", "date_of_birth", "date_of_joining", "company", "department", "designation", "cell_number",
				"company_email", "personal_email", "status", "relieving_date"].forEach((f) => (values[f] = employee[f] || ""));
			d.set_values(values);
		}
		d.show();
		// mobile: digits only, at most 10, as it is typed
		d.fields_dict.cell_number.$input.attr({ maxlength: 10, inputmode: "numeric" }).on("input", function () {
			const clean = this.value.replace(/\D/g, "").slice(0, 10);
			if (clean !== this.value) this.value = clean;
		});
	}

	/** Quick dialog for a new Asset Category Type (a standard record). */
	newTypeDialog(onDone) {
		const d = new frappe.ui.Dialog({
			title: __("New Category Type"),
			fields: [
				{ fieldtype: "Data", fieldname: "type_name", label: __("Type Name"), reqd: 1, description: __("e.g. Furniture, Vehicle, Software Licence") },
				{ fieldtype: "Check", fieldname: "is_subscription", label: __("Works like a Subscription"),
					description: __("Tick for recurring licences: renewal date, billing cycle and monthly cost. Leave unticked for physical items (purchase value, warranty).") },
				{ fieldtype: "Select", fieldname: "color", label: __("Tag Colour"), default: "green",
					options: ["blue", "purple", "green", "orange", "red", "yellow", "cyan", "pink", "gray"] },
				{ fieldtype: "Small Text", fieldname: "description", label: __("Description") },
			],
			primary_action_label: __("Create"),
			primary_action: async (v) => {
				await frappe.xcall("frappe.client.insert", { doc: { doctype: "Asset Category Type", ...v, is_subscription: v.is_subscription ? 1 : 0 } });
				d.hide();
				frappe.show_alert({ message: __("Category Type {0} created", [v.type_name]), indicator: "green" });
				const b = await this.api("boot");
				this.boot.category_types = b.category_types;
				amSetTypeColours(Object.entries(b.category_types || {}).map(([name, t]) => ({ name, color: t.color })));
				onDone && onDone();
			},
		});
		d.show();
	}

	/** Edit a sub-category's Specification Fields (Item Group > Asset Specification Fields). */
	async specFieldsDialog(itemGroup, onDone) {
		const { fields } = await frappe.xcall("asset_management.asset_management.specifications.get_fields", { item_group: itemGroup });
		const d = new frappe.ui.Dialog({
			title: __("Specification Fields: {0}", [itemGroup]),
			size: "large",
			fields: [
				{ fieldtype: "HTML", options: `<p class="text-muted">${__("Every asset in {0} asks for these on its Specifications tab and in Bulk Create. Other sub-categories have their own (a keyboard needs no RAM; a CCTV camera has Resolution and Lens).", [`<b>${amEsc(itemGroup)}</b>`])}</p>
					<p class="text-muted">${__("Tick <b>Per Unit</b> for values that differ between units (IMEI, MAC address…): when an asset is saved with a quantity above 1, or created in bulk, they are asked for each unit next to its serial number. The others are entered once for all units.")}</p>` },
				{
					fieldtype: "Table", fieldname: "fields", label: __("Fields"), in_place_edit: true, cannot_add_rows: false,
					data: fields.map((f) => ({ ...f, options: String(f.options || "").replace(/\n/g, ", ") })),
					fields: [
						{ fieldtype: "Data", fieldname: "field_label", label: __("Field"), in_list_view: 1, reqd: 1, columns: 3 },
						{ fieldtype: "Select", fieldname: "field_type", label: __("Type"), options: "Text\nNumber\nSelect\nYes/No\nDate", default: "Text", in_list_view: 1, columns: 2 },
						{ fieldtype: "Data", fieldname: "options", label: __("Choices (for Select, comma separated)"), in_list_view: 1, columns: 3 },
						{ fieldtype: "Check", fieldname: "mandatory", label: __("Mandatory"), in_list_view: 1, columns: 1 },
						{ fieldtype: "Check", fieldname: "per_unit", label: __("Per Unit"), in_list_view: 1, columns: 1 },
					],
				},
			],
			primary_action_label: __("Save"),
			primary_action: async (v) => {
				d.disable_primary_action();
				try {
					await frappe.xcall("asset_management.asset_management.specifications.save_fields", { item_group: itemGroup, fields: v.fields || [] });
					d.hide();
					frappe.show_alert({ message: __("Specification fields of {0} saved", [itemGroup]), indicator: "green" });
					onDone && onDone();
				} finally {
					d.enable_primary_action();
				}
			},
		});
		d.show();
	}

	/** Take assets back: a standard Asset Movement (Receipt) to the asset's location, which clears the Custodian. */
	returnDialog({ assets, holder, onDone }) {
		const d = new frappe.ui.Dialog({
			title: assets.length > 1 ? __("Return {0} Assets", [assets.length]) : __("Return Asset"),
			fields: [
				{ fieldtype: "HTML", fieldname: "assets_html", options: `<div class="form-group"><label class="control-label">${assets.length === 1 ? __("Asset") : __("{0} assets", [assets.length])}${holder ? " " + __("from {0}", [amEsc(holder)]) : ""}</label><div class="am-tags">${assets.map((a) => amPill(a, "blue")).join("")}</div></div>` },
				{ fieldtype: "Datetime", fieldname: "returned_on", label: __("Returned On"), reqd: 1, default: frappe.datetime.now_datetime() },
				{ fieldtype: "HTML", fieldname: "note", options: `<p class="text-muted small">${__("Creates and submits a standard Asset Movement (Receipt) back to the asset's location.")}</p>` },
			],
			primary_action_label: __("Return"),
			primary_action: async (v) => {
				d.disable_primary_action();
				try {
					const r = await this.api("unassign", { assets, returned_on: v.returned_on });
					d.hide();
					frappe.show_alert({ message: __("{0} returned ({1})", [assets.length === 1 ? assets[0] : __("{0} assets", [assets.length]), r.movements.join(", ")]), indicator: "green" }, 6);
					(onDone || (() => this.refresh()))();
				} finally {
					d.enable_primary_action();
				}
			},
		});
		d.show();
	}
}

// ------------------------------------------------------------------ views: shared bits

class AmView {
	constructor(app, name) {
		this.app = app;
		this.name = name;
	}
	get page() {
		return this.app.page;
	}
	get $body() {
		return this.app.$body;
	}
	get boot() {
		return this.app.boot;
	}
	api(m, a) {
		return this.app.api(m, a);
	}
	$(s) {
		return this.$body.find(s);
	}
	/** Standard number cards. cards: [{label, value, color, go, act, s}] */
	numberCards(cards) {
		return `<div class="am-number-cards">${cards.map((c) => `
			<div class="widget number-widget-box ${c.act || c.go ? "am-click" : ""}" ${c.go ? `data-go="${amEsc(c.go)}"` : ""} ${c.act ? `data-act="${amEsc(c.act)}"` : ""} ${c.s != null ? `data-s="${amEsc(c.s)}"` : ""}>
				<div class="widget-head"><div class="widget-label"><div class="widget-title"><div class="number-label">${amEsc(c.label)}</div></div></div></div>
				<div class="widget-body"><div class="widget-content"><div class="number" ${c.color ? `style="color:var(--${c.color}-600)"` : ""}>${c.value}</div></div></div>
			</div>`).join("")}</div>`;
	}
	card(title, body, { count = null, actions = "", cls = "", attrs = "" } = {}) {
		return `<div class="frappe-card am-card ${cls}" ${attrs}>
			<div class="am-card-head"><h5>${title}${count != null ? `<span class="am-count">${count}</span>` : ""}</h5>${actions ? `<div class="am-actions">${actions}</div>` : ""}</div>
			${body}</div>`;
	}
	/** cols: [[label, render(row), {right, cls}]]; go(row) -> "sub|name" makes the row open that view */
	table(cols, rows, { go = null, scroll = false, empty = __("Nothing to show.") } = {}) {
		if (!rows.length) return amEmpty(empty);
		return `<div class="table-responsive ${scroll ? "am-scroll" : ""}"><table class="table table-hover am-table"><thead><tr>
			${cols.map(([l, , o = {}]) => `<th class="${o.right ? "text-right" : ""} ${o.cls || ""}">${l}</th>`).join("")}</tr></thead><tbody>
			${rows.map((r) => `<tr ${go ? `data-go="${amEsc(go(r))}"` : ""}>${cols.map(([, render, o = {}]) => `<td class="${o.right ? "text-right" : ""} ${o.cls || ""}">${render(r)}</td>`).join("")}</tr>`).join("")}
		</tbody></table></div>`;
	}
	btn(label, act, { primary = false, data = {}, disabled = false } = {}) {
		const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${amEsc(v)}"`).join(" ");
		return `<button class="btn btn-xs ${primary ? "btn-primary" : "btn-default"}" data-act="${act}" ${attrs} ${disabled ? "disabled" : ""}>${label}</button>`;
	}
	/** Bind data-act buttons inside the body to this.onAct. */
	bindActs() {
		this.$body.off("click.amact").on("click.amact", "[data-act]", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.onAct && this.onAct(e.currentTarget.dataset.act, e.currentTarget);
		});
	}
	who(name, sub, image) {
		const av = image
			? `<span class="avatar avatar-medium"><img class="avatar-frame" src="${encodeURI(image)}" alt=""></span>`
			: `<span class="avatar avatar-medium"><span class="avatar-frame standard-image">${amEsc(amInitials(name))}</span></span>`;
		return `<div class="am-who">${av}<div style="min-width:0"><div class="bold">${amEsc(name)}</div>${sub ? amMuted(sub) : ""}</div></div>`;
	}
	expiryHtml(r) {
		if (!r.expiry_date) return `<span class="text-muted">—</span>`;
		const days = Math.round((new Date(r.expiry_date + "T00:00:00") - new Date(this.boot.today + "T00:00:00")) / 864e5);
		const soon = this.boot.expiry_alert_days ?? 45;  // Settings > Warranty / Renewal Alert
		const cls = days < 0 ? "am-days-late" : days <= soon ? "am-days-near" : "";
		const note = days < 0 ? __("{0}d overdue", [-days]) : days <= soon ? __("in {0}d", [days]) : "";
		return `${amDate(r.expiry_date)}${note ? `<div class="small ${cls}">${note}</div>` : ""}`;
	}
	/** Standard page-form filters (the bar under the page title). Returns the controls by fieldname. */
	addFilters(defs, onChange) {
		const out = {};
		defs.forEach((df) => {
			const f = this.page.add_field({ ...df, change: df.fieldtype === "Data" ? null : () => onChange(df.fieldname, f.get_value()) });
			if (df.fieldtype === "Data") {
				f.$input.on("input", frappe.utils.debounce(() => onChange(df.fieldname, f.get_value()), 300));
			}
			out[df.fieldname] = f;
		});
		return out;
	}
	categoryOptions() {
		return [{ value: "", label: __("All Categories") }, ...this.boot.categories.map((c) => ({ value: c.name, label: c.name }))];
	}
	subCategoryOptions(category) {
		const subs = this.boot.sub_categories.filter((s) => !category || s.category === category);
		return [{ value: "", label: __("All Sub-Categories") }, ...subs.map((s) => ({ value: s.name, label: s.name }))];
	}
	/** Search + category + sub-category filters wired to this.filters and this.reload(). */
	assetFilters(placeholder, extra = []) {
		const f = this.addFilters([
			{ fieldtype: "Data", fieldname: "search", label: placeholder, default: this.filters.search },
			{ fieldtype: "Select", fieldname: "category", label: __("Category"), options: this.categoryOptions(), default: this.filters.category },
			{ fieldtype: "Select", fieldname: "sub_category", label: __("Sub-Category"), options: this.subCategoryOptions(this.filters.category), default: this.filters.sub_category },
			...extra,
		], (key, value) => {
			this.filters[key] = value || "";
			if (key === "category") {
				this.filters.sub_category = "";
				f.sub_category.df.options = this.subCategoryOptions(value);
				f.sub_category.refresh();
				f.sub_category.set_input("");
			}
			this.reload();
		});
		return f;
	}
	reload() {
		return this.render((this.app.token = Symbol()));
	}
}

// ------------------------------------------------------------------ dashboard

class AmDashboardView extends AmView {
	async render(token) {
		const d = await this.api("dashboard");
		if (this.app.stale(token)) return;
		const s = d.by_status;
		this.page.set_title(__("Asset Workspace"));
		if (this.boot.can_assign) this.page.set_primary_action(__("Assign & Return"), () => this.app.go("assign"), "es-line-arrow-swap");
		if (this.boot.can_write) this.page.set_secondary_action(__("New Asset"), () => frappe.new_doc("Asset"));
		this.$body.html(`
			<p class="text-muted">${__("{0} assets · {1} of {2} employees hold assets", [d.total, d.holders, d.employees])}</p>
			${this.numberCards([
				{ label: __("Total Assets"), value: d.total, go: "assets" },
				{ label: __("Assigned"), value: s.Assigned, color: "blue" },
				{ label: __("Available"), value: s.Available, color: "green" },
				{ label: __("Draft (not submitted)"), value: s.Draft, color: s.Draft ? "red" : "", act: "drafts" },
				{ label: __("Subscriptions / Month"), value: amInr(d.subscription_monthly), color: "purple" },
				{ label: __("Hardware Value"), value: amInr(d.hardware_value) },
			])}
			${d.categories.length ? `<div class="am-grid">${d.categories.map((c) => this.card(`${amEsc(c.name)} ${amPill(c.type)}`, `
				<div class="am-cat-total">${c.total} <span class="text-muted small">${__("assets")}</span></div>
				<div class="text-muted small">${__("{0} assigned · {1} available", [c.assigned, c.available])}</div>
				${c.subs.map((sc) => `<div class="am-sub"><span>${amEsc(sc.name)}</span><span class="text-muted">${__("{0} of {1} assigned", [sc.assigned, sc.total])}</span>
					<div class="progress"><div class="progress-bar" style="width:${sc.total ? (sc.assigned / sc.total) * 100 : 0}%"></div></div></div>`).join("")}`,
				{ cls: "am-cat-card", attrs: `data-act="cat" data-c="${amEsc(c.name)}"` })).join("")}</div>`
			: this.card(__("No assets yet"), amEmpty(__("Set up categories in the Catalogue, then add assets.")))}
			${d.categories.length ? this.card(__("Assigned vs Available by Category"), `<div class="am-chart"></div>`) : ""}
			<div class="am-grid" style="margin-top:var(--margin-md)">
				${this.card(__("Warranties & Renewals") + ` <span class="text-muted small">${__("overdue or due in 45 days")}</span>`, this.table([
					[__("Asset"), (a) => `<div class="bold">${amEsc(a.name)}</div>${amPath(a)}`],
					[__("Holder"), (a) => (a.employee_name ? amEsc(a.employee_name) : amPill(a.status))],
					[__("Date"), (a) => this.expiryHtml(a)],
				], d.expiring, { go: (a) => `asset|${a.name}`, empty: __("No warranty or renewal is overdue or due in the next 45 days.") }))}
				${this.card(__("Recent Activity"), d.recent.length ? `<ul class="am-activity">${d.recent.map((r) => `<li data-go="asset|${amEsc(r.asset)}">
					<span class="indicator ${r.status === "Assigned" ? "blue" : "gray"}"></span>
					<div><div>${amEsc(r.asset)} ${r.status === "Assigned" ? __("issued to") : __("returned by")} <b>${amEsc(r.employee_name || r.employee)}</b></div>
					${amMuted(`${r.category || ""} · ${amDate(r.date)} · ${r.movement}`)}</div></li>`).join("")}</ul>` : amEmpty(__("No assignments yet.")),
				{ actions: `<a href="#" class="small" data-go="employees">${__("Employee mapping")} →</a>` })}
			</div>`);
		this.bindActs();
		if (d.categories.length) {
			new frappe.Chart(this.$(".am-chart")[0], {
				type: "bar",
				height: 240,
				barOptions: { stacked: 1, spaceRatio: 0.5 },
				colors: ["#2490ef", "#29cd42"],
				data: {
					labels: d.categories.map((c) => c.name),
					datasets: [
						{ name: __("Assigned"), values: d.categories.map((c) => c.assigned) },
						{ name: __("Available"), values: d.categories.map((c) => c.available) },
					],
				},
			});
		}
	}
	onAct(act, el) {
		if (act === "cat") {
			this.app._assetFilters = { search: "", category: el.dataset.c, sub_category: "", status: "" };
			this.app.go("assets");
		} else if (act === "drafts") {
			this.app._assetFilters = { search: "", category: "", sub_category: "", status: "Draft" };
			this.app.go("assets");
		}
	}
}

// ------------------------------------------------------------------ assign & return (the main working page)

class AmAssignView extends AmView {
	constructor(app) {
		super(app);
		this.filters = Object.assign({ search: "", category: "", sub_category: "" }, app._assignFilters || {});
		this.picked = { available: new Set(), assigned: new Set() };
	}
	async render(token) {
		if (!this.controls) {
			this.page.set_title(__("Assign & Return"));
			this.controls = this.assetFilters(__("Search asset, serial no or employee"));
		}
		const d = (this.data = await this.api("assign_board", { filters: this.filters }));
		if (this.app.stale(token)) return;
		this.app._assignFilters = this.filters;
		// keep only selections that are still on the board
		const still = (key) => new Set([...this.picked[key]].filter((n) => d[key].some((r) => r.name === n)));
		this.picked = { available: still("available"), assigned: still("assigned") };
		const can = this.boot.can_assign;
		const filtered = this.filters.search || this.filters.category;
		const ck = (key, r) => `<input type="checkbox" class="am-no-go" data-pick="${key}" value="${amEsc(r.name)}" ${this.picked[key].has(r.name) ? "checked" : ""}>`;
		const all = (key) => `<input type="checkbox" class="am-no-go" data-all="${key}" title="${__("Select all")}">`;
		this.$body.html(`
			<p class="text-muted">${__("Tick assets on the left and assign them to an employee; tick assets on the right to take them back. Each one is a standard Asset Movement.")}</p>
			${d.drafts ? `<div class="alert alert-warning">${__("{0} asset(s) are still Draft. Submit them on the Asset form to assign.", [d.drafts])} <a href="#" data-act="drafts">${__("Show drafts")} →</a></div>` : ""}
			<div class="am-grid">
				${this.card(__("Available"), this.table([
					...(can ? [[all("available"), (r) => ck("available", r), { cls: "am-ck" }]] : []),
					[__("Asset"), (r) => `${amLink(`asset|${r.name}`, r.name)}${amPath(r)}`],
					[__("Type"), (r) => `${amPill(r.category_type)}${r.serial_no ? amMuted(r.serial_no) : ""}`],
					...(can ? [["", (r) => this.btn(__("Assign"), "assign-one", { primary: true, data: { n: r.name } }), { right: true }]] : []),
				], d.available, { scroll: true, empty: filtered ? __("Nothing available for these filters.") : __("Nothing available.") }), {
					count: d.available.length,
					actions: can ? this.btn(__("Assign Selected"), "assign-picked", { primary: true, disabled: true }) : "",
				})}
				${this.card(__("With Employees"), this.table([
					...(can ? [[all("assigned"), (r) => ck("assigned", r), { cls: "am-ck" }]] : []),
					[__("Asset"), (r) => `${amLink(`asset|${r.name}`, r.name)}${amPath(r)}`],
					[__("Employee"), (r) => `${amLink(`employee|${r.assigned_to}`, r.employee_name || r.assigned_to)}${amMuted(amDept(r.department) || r.assigned_to)}`],
					[__("Since"), (r) => `${amDate(r.assigned_on)}${r.acknowledgement ? `<div>${amAck(r.acknowledgement)}</div>` : ""}`],
					...(can ? [["", (r) => `${this.btn(__("Transfer"), "transfer-one", { data: { n: r.name } })} ${this.btn(__("Return"), "return-one", { data: { n: r.name } })}`, { right: true }]] : []),
				], d.assigned, { scroll: true, empty: filtered ? __("No assets are with employees for these filters.") : __("No assets are with employees.") }), {
					count: d.assigned.length,
					actions: can ? `${this.btn(__("Transfer Selected"), "transfer-picked", { disabled: true })} ${this.btn(__("Return Selected"), "return-picked", { disabled: true })}` : "",
				})}
			</div>`);
		this.bindActs();
		this.$body.off("change.ampick").on("change.ampick", "input[type=checkbox]", (e) => this.onPick(e.target));
		this.paintPicked();
	}
	onPick(box) {
		if (box.dataset.all) {
			const key = box.dataset.all;
			this.$(`[data-pick=${key}]`).each((_, b) => {
				b.checked = box.checked;
				this.picked[key][box.checked ? "add" : "delete"](b.value);
			});
		} else if (box.dataset.pick) {
			this.picked[box.dataset.pick][box.checked ? "add" : "delete"](box.value);
		}
		this.paintPicked();
	}
	paintPicked() {
		[["available", "assign-picked", __("Assign Selected")], ["assigned", "return-picked", __("Return Selected")], ["assigned", "transfer-picked", __("Transfer Selected")]].forEach(([key, act, label]) => {
			const n = this.picked[key].size;
			this.$(`[data-act=${act}]`).prop("disabled", !n).text(n ? `${label} (${n})` : label);
			const all = this.$(`[data-all=${key}]`)[0];
			const boxes = this.$(`[data-pick=${key}]`).toArray();
			if (all) {
				all.checked = boxes.length > 0 && boxes.every((b) => b.checked);
				all.indeterminate = !all.checked && boxes.some((b) => b.checked);
			}
		});
	}
	onAct(act, el) {
		const done = () => {
			this.picked = { available: new Set(), assigned: new Set() };
			this.reload();
		};
		if (act === "drafts") {
			this.app._assetFilters = { search: "", category: "", sub_category: "", status: "Draft" };
			return this.app.go("assets");
		}
		if (act === "assign-one") this.app.assignDialog({ assets: [el.dataset.n], onDone: done });
		else if (act === "assign-picked") this.app.assignDialog({ assets: [...this.picked.available], onDone: done });
		else if (["return-one", "return-picked", "transfer-one", "transfer-picked"].includes(act)) {
			const names = act.endsWith("-one") ? [el.dataset.n] : [...this.picked.assigned];
			const holders = new Set(this.data.assigned.filter((r) => names.includes(r.name)).map((r) => r.employee_name || r.assigned_to));
			const holder = holders.size === 1 ? [...holders][0] : "";
			if (act.startsWith("transfer")) this.app.transferDialog({ assets: names, holder, onDone: done });
			else this.app.returnDialog({ assets: names, holder, onDone: done });
		}
	}
}

// ------------------------------------------------------------------ employee mapping

class AmEmployeesView extends AmView {
	constructor(app) {
		super(app);
		this.filters = Object.assign({ search: "", department: "", holding: "" }, app._empFilters || {});
	}
	newEmployee() {
		this.app.employeeDialog({ onDone: () => this.reload() });
	}
	async render(token) {
		if (!this.controls) {
			this.page.set_title(__("Employees"));
			if (this.boot.can_add_employee) this.page.set_primary_action(__("New Employee"), () => this.newEmployee(), "add");
			this.controls = this.addFilters([
				{ fieldtype: "Data", fieldname: "search", label: __("Search name, ID or designation"), default: this.filters.search },
				{ fieldtype: "Select", fieldname: "department", label: __("Department"), options: [{ value: "", label: __("All Departments") }], default: this.filters.department },
				{ fieldtype: "Select", fieldname: "holding", label: __("Holding"), default: this.filters.holding,
					options: [{ value: "", label: __("All Employees") }, { value: "yes", label: __("Holding Assets") }, { value: "no", label: __("No Assets") }] },
			], (key, value) => {
				this.filters[key] = value || "";
				this.reload();
			});
		}
		const d = await this.api("employees", { search: this.filters.search, department: this.filters.department });
		if (this.app.stale(token)) return;
		this.app._empFilters = this.filters;
		const dep = this.controls.department;
		if (!dep._loaded) {
			dep.df.options = [{ value: "", label: __("All Departments") }, ...d.departments.map((x) => ({ value: x, label: amDept(x) }))];
			dep.refresh();
			dep.set_input(this.filters.department);
			dep._loaded = true;
		}
		const all = d.rows;
		const withAssets = all.filter((r) => r.assets.length);
		const rows = this.filters.holding === "yes" ? withAssets : this.filters.holding === "no" ? all.filter((r) => !r.assets.length) : all;
		const can = this.boot.can_assign;
		this.$body.html(`
			${this.numberCards([
				{ label: __("Active Employees"), value: all.length },
				{ label: __("Holding Assets"), value: withAssets.length, color: "blue" },
				{ label: __("No Assets"), value: all.length - withAssets.length },
			])}
			${this.card(__("Employee Mapping"), this.table([
				[__("Employee"), (r) => this.who(r.employee_name, `${r.name}${r.designation ? " · " + r.designation : ""}`, r.image)],
				[__("Department"), (r) => amEsc(amDept(r.department) || "—")],
				[__("Hardware"), (r) => r.hardware || `<span class="text-muted">0</span>`, { right: true }],
				[__("Subscriptions"), (r) => r.subscriptions || `<span class="text-muted">0</span>`, { right: true }],
				[__("Assets"), (r) => `<div class="am-tags">${r.assets.slice(0, 3).map((a) => amPill(a, "blue")).join("")}${r.assets.length > 3 ? amPill("+" + (r.assets.length - 3), "gray") : ""}${r.assets.length ? "" : `<span class="text-muted">—</span>`}</div>`],
				...(can ? [["", (r) => this.btn(__("Assign"), "assign", { data: { e: r.name } }), { right: true }]] : []),
			], rows, { go: (r) => `employee|${r.name}`, empty: all.length ? __("No employees match.") : __("No employees yet. Use New Employee to add one.") }), { count: rows.length })}`);
		this.bindActs();
	}
	onAct(act, el) {
		if (act === "assign") this.app.assignDialog({ employee: el.dataset.e });
	}
}

class AmEmployeeView extends AmView {
	async render(token) {
		const d = (this.data = await this.api("employee", { name: this.name }));
		if (this.app.stale(token)) return;
		const e = d.employee;
		const cur = d.current;
		const can = this.boot.can_assign;
		const hw = cur.filter((a) => !a.is_subscription).length;
		this.page.set_title(e.employee_name);  // every render, so an edited name shows at once
		if (e.status && e.status !== "Active") this.page.set_indicator(__(e.status), "gray");
		else this.page.clear_indicator();
		if (!this.headed) {
			this.headed = true;
			this.page.add_inner_button(__("Employees"), () => this.app.go("employees"));
			if (e.can_edit) this.page.add_inner_button(__("Edit"), () => this.app.employeeDialog({ employee: this.data.employee, onDone: () => this.reload() }));
			this.page.add_inner_button(__("Employee Record"), () => frappe.set_route("Form", "Employee", e.name));
			if (can) this.page.set_primary_action(__("Assign Asset"), () => this.app.assignDialog({ employee: e.name, onDone: () => this.reload() }));
		}
		const info = [e.name, e.designation, amDept(e.department), e.prefered_email || e.company_email || e.personal_email].filter(Boolean).join(" · ");
		this.$body.html(`
			<div class="frappe-card am-card" style="margin-bottom:var(--margin-md)">${this.who(e.employee_name, info, e.image)}</div>
			${this.numberCards([
				{ label: __("Assets Held"), value: cur.length },
				{ label: __("Hardware"), value: hw, color: "blue" },
				{ label: __("Subscriptions"), value: cur.length - hw, color: "purple" },
				{ label: __("Assignments to Date"), value: d.history.length },
			])}
			${this.card(__("Currently Holding"), this.table([
				[__("Asset"), (a) => `<div class="bold">${amEsc(a.name)}</div>${amPath(a)}`],
				[__("Type"), (a) => amPill(a.category_type)],
				[__("Serial / Licence"), (a) => amEsc(a.serial_no || "—")],
				[__("Since"), (a) => amDate(a.assigned_on)],
				[__("Acknowledged"), (a) => amAck(a.acknowledgement) || `<span class="text-muted">—</span>`],
				[__("Warranty / Renewal"), (a) => this.expiryHtml(a)],
				...(can ? [["", (a) => `${this.btn(__("Transfer"), "transfer", { data: { n: a.name } })} ${this.btn(__("Return"), "return", { data: { n: a.name } })}`, { right: true }]] : []),
			], cur, { go: (a) => `asset|${a.name}`, empty: __("{0} holds no assets.", [e.employee_name]) }), {
				count: cur.length,
				actions: can && cur.length > 1 ? this.btn(__("Return All ({0})", [cur.length]), "return-all") : "",
			})}
			${this.card(__("History"), this.table([
				[__("Asset"), (h) => `<div class="bold">${amEsc(h.asset)}</div>${amMuted(h.category || "")}`],
				[__("Received From"), (h) => (h.from_employee ? amEsc(h.from_employee_name || h.from_employee) : amMuted(__("Stock")))],
				[__("Assigned"), (h) => amDateTime(h.assigned_on)],
				[__("Returned / Handed To"), (h) => (h.returned_on
					? `${amDateTime(h.returned_on)}${amMuted(h.handed_to ? __("handed to {0}", [h.handed_to_name || h.handed_to]) : __("returned to stock"))}`
					: `<span class="text-muted">—</span>`)],
				[__("Location"), (h) => amEsc(h.location || "—")],
				[__("Condition"), (h) => amStars(h.condition)],
				[__("Acknowledged"), (h) => amAck(h.acknowledgement_status) || `<span class="text-muted">—</span>`],
				[__("Status"), (h) => amPill(h.status)],
			], d.history, { go: (h) => `asset|${h.asset}`, empty: __("No assignments yet.") }))}`);
		this.bindActs();
	}
	onAct(act, el) {
		const e = this.data.employee;
		const done = () => this.reload();
		if (act === "return") this.app.returnDialog({ assets: [el.dataset.n], holder: e.employee_name, onDone: done });
		else if (act === "transfer") this.app.transferDialog({ assets: [el.dataset.n], holder: e.employee_name, onDone: done });
		else if (act === "return-all") this.app.returnDialog({ assets: this.data.current.map((a) => a.name), holder: e.employee_name, onDone: done });
	}
}

// ------------------------------------------------------------------ asset register

class AmAssetsView extends AmView {
	constructor(app) {
		super(app);
		this.filters = Object.assign({ search: "", category: "", sub_category: "", status: "" }, app._assetFilters || {});
		app._assetFilters = null;
	}
	async render(token) {
		if (!this.controls) {
			this.page.set_title(__("Asset Register"));
			if (this.boot.can_write) this.page.set_primary_action(__("New Asset"), () => frappe.new_doc("Asset"), "add");
			if (this.boot.can_bulk_create) this.page.add_inner_button(__("Bulk Create"), () => this.app.bulkCreateDialog());
			this.controls = this.assetFilters(__("Search asset, item, serial no or employee"), [
				{ fieldtype: "Select", fieldname: "status", label: __("Status"), default: this.filters.status,
					options: [{ value: "", label: __("All Statuses") }, ...AM_STATUSES.map((s) => ({ value: s, label: __(s) }))] },
			]);
		}
		const d = await this.api("assets", { filters: this.filters });
		if (this.app.stale(token)) return;
		const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
		this.$body.html(`
			${this.numberCards([
				{ label: __("All"), value: total, act: "status", s: "" },
				...AM_STATUSES.map((s) => ({ label: __(s), value: d.counts[s] || 0, color: { Available: "green", Assigned: "blue", Draft: "red", "Under Repair": "orange" }[s], act: "status", s })),
			])}
			${this.card(__("Assets"), this.table([
				[__("Asset"), (r) => `<div class="bold">${amEsc(r.name)}</div>${r.serial_no ? amMuted(r.serial_no) : ""}`],
				[__("Item"), (r) => `${amEsc(r.item)}${amPath(r)}`],
				[__("Type"), (r) => amPill(r.category_type)],
				[__("Status"), (r) => amPill(r.status)],
				[__("Assigned To"), (r) => (r.assigned_to ? `${amEsc(r.employee_name || r.assigned_to)}${amMuted(__("since {0}", [amDate(r.assigned_on)]))}${r.acknowledgement ? amAck(r.acknowledgement) : ""}` : `<span class="text-muted">—</span>`)],
				[__("Warranty / Renewal"), (r) => this.expiryHtml(r)],
				[__("Cost"), (r) => (r.purchase_cost ? amInr(r.purchase_cost) + (r.billing_cycle ? amMuted(r.billing_cycle === "Yearly" ? __("per year") : __("per month")) : "") : `<span class="text-muted">—</span>`), { right: true }],
			], d.rows, { go: (r) => `asset|${r.name}`, empty: __("No assets match.") }), { count: d.rows.length })}`);
		// the number cards double as status filters; outline the one in use
		this.$(".number-widget-box[data-act=status]").each((_, el) => el.classList.toggle("am-on", el.dataset.s === this.filters.status));
		this.bindActs();
	}
	onAct(act, el) {
		if (act === "status") {
			this.filters.status = el.dataset.s;
			this.controls.status.set_input(this.filters.status);
			this.reload();
		}
	}
}

class AmAssetView extends AmView {
	async render(token) {
		const d = (this.data = await this.api("asset", { name: this.name }));
		if (this.app.stale(token)) return;
		const a = d.doc;
		const can = this.boot.can_assign;
		const sub = a.is_subscription;
		const holder = d.holder;
		const p = this.page;
		p.set_title(a.name);
		p.set_indicator(__(a.status), AM_INDICATOR[a.status] || "gray");
		p.clear_inner_toolbar();
		p.clear_primary_action();
		p.add_inner_button(__("Asset Register"), () => this.app.go("assets"));
		p.add_inner_button(a.status === "Draft" ? __("Open to Submit") : __("Asset Form"), () => frappe.set_route("Form", "Asset", a.name));
		if (can && a.status === "Available") p.set_primary_action(__("Assign"), () => this.app.assignDialog({ assets: [a.name], onDone: () => this.reload() }));
		if (can && a.status === "Assigned") p.set_primary_action(__("Return"), () => this.app.returnDialog({ assets: [a.name], holder: a.employee_name, onDone: () => this.reload() }));
		if (can && ["Available", "Assigned"].includes(a.status)) p.add_inner_button(__("Transfer"), () => this.app.transferDialog({ assets: [a.name], holder: a.employee_name, onDone: () => this.reload() }));
		const kv = (label, value) => `<div class="frappe-control"><label class="control-label">${label}</label><div class="control-value like-disabled-input">${value || "—"}</div></div>`;
		const ack = d.acknowledgement;
		const ackHtml = ack
			? `<div style="margin-top:var(--margin-sm)">${amAck(ack.status)}
				<span class="text-muted small">${ack.status === "Completed"
					? __("on {0}{1}", [frappe.datetime.str_to_user(String(ack.acknowledged_on)), ack.acknowledged_ip ? " · " + amEsc(ack.acknowledged_ip) : ""])
					: ack.email ? __("emailed to {0} · sent {1} time(s)", [amEsc(ack.email), ack.sent_count || 0]) : __("no email address")}</span>
				${ack.employee_remarks ? `<div class="small" style="margin-top:6px;white-space:pre-wrap"><b>${__("Employee remarks")}:</b> ${amEsc(ack.employee_remarks)}</div>` : ""}
				${ack.status === "Pending" && this.boot.can_see_acks ? `<div class="am-actions" style="margin-top:6px">${this.btn(__("Resend"), "ack-resend", { data: { n: ack.name } })} ${this.btn(__("Copy Link"), "ack-link", { data: { n: ack.name } })}</div>` : ""}
			</div>`
			: "";
		const specs = d.specifications || [];
		const specsHtml = specs.length
			? `<div class="am-spec-grid">${specs.map((s) => `<div><div class="label">${amEsc(s.label)}${s.mandatory ? " *" : ""}</div><div class="value">${s.value ? amEsc(s.value) : `<span class="text-muted">—</span>`}</div></div>`).join("")}</div>`
			: amEmpty(a.sub_category ? __("No specification fields for {0}. Add them in Catalogue › {0} › Fields.", [a.sub_category]) : __("No specifications."));
		const who = (id, nameText) => (id ? amEsc(nameText || id) : "");
		this.$body.html(`
			<div class="am-grid">
				${this.card(__("Details"), `<div class="am-kv">
					${kv(__("Category"), `${amEsc(a.category)} ${amPill(a.category_type)}`)}
					${kv(__("Sub-Category"), amEsc(a.sub_category))}
					${kv(__("Item"), `${amEsc(a.item)}${d.brand ? ` <span class="text-muted">· ${amEsc(d.brand)}</span>` : ""}`)}
					${kv(sub ? __("Licence / Account ID") : __("Serial No"), amEsc(a.serial_no))}
					${kv(sub ? __("Start Date") : __("Purchase Date"), amDate(a.purchase_date))}
					${kv(__("Location"), amEsc(a.location))}
					${kv(__("ERPNext Status"), amEsc(a.erp_status))}
					${kv(__("Cost"), a.purchase_cost ? amInr(a.purchase_cost) + (a.billing_cycle ? (a.billing_cycle === "Yearly" ? " / " + __("year") : " / " + __("month")) : "") : "")}
					${kv(sub ? __("Renewal Date") : __("Warranty Until"), this.expiryHtml(a))}
				</div>`)}
				${this.card(__("Assigned To"), holder
					? `<a href="#" data-go="employee|${amEsc(holder.name)}" style="display:block">${this.who(holder.employee_name, [holder.name, holder.designation, amDept(holder.department)].filter(Boolean).join(" · "), holder.image)}</a>
						<p class="text-muted small" style="margin-top:var(--margin-sm)">${__("Since {0}", [amDate(a.assigned_on)])}${a.location ? " · " + amEsc(a.location) : ""}</p>${ackHtml}`
					: amEmpty(a.status === "Available" ? __("Not assigned. It is ready to hand out.") : __("Not assigned: {0}.", [__(a.status)])))}
			</div>
			${this.card(__("Specifications"), specsHtml, { actions: a.sub_category && this.boot.can_edit_fields ? this.btn(__("Edit Fields"), "spec-fields", { data: { s: a.sub_category } }) : "" })}
			${this.card(__("Custody History"), this.table([
				[__("Employee"), (h) => `<div class="bold">${amEsc(h.employee_name || h.employee)}</div>${amMuted(amDept(h.department) || h.employee)}`],
				[__("Received From"), (h) => (h.from_employee ? `<div>${amEsc(h.from_employee_name || h.from_employee)}</div>${amMuted(__("transferred"))}` : amMuted(__("Stock")))],
				[__("Assigned"), (h) => amDateTime(h.assigned_on)],
				[__("Returned / Handed To"), (h) => (h.returned_on
					? `${amDateTime(h.returned_on)}${amMuted(h.handed_to ? __("handed to {0}", [h.handed_to_name || h.handed_to]) : __("returned to stock"))}`
					: `<span class="text-muted">—</span>`)],
				[__("Location"), (h) => `${amEsc(h.location || "—")}${(h.transfers || []).map((t) => amMuted(__("moved {0} → {1} on {2}", [t.from || "—", t.to, amDate(t.date)]))).join("")}`],
				[__("Condition at Hand-over"), (h) => `${amStars(h.condition)}${h.condition_notes ? amMuted(h.condition_notes) : ""}`],
				[__("Acknowledged"), (h) => (h.acknowledgement_status ? `${amAck(h.acknowledgement_status)}${h.acknowledged_on ? amDateTime(h.acknowledged_on) : ""}${h.employee_remarks ? amMuted(__("Remarks: {0}", [h.employee_remarks])) : ""}` : `<span class="text-muted">—</span>`)],
				[__("Status"), (h) => amPill(h.status)],
			], d.history, { go: (h) => `employee|${h.employee}`, empty: __("Never assigned.") }))}
			${this.card(__("Movement Log"), this.table([
				[__("Date"), (e) => amDateTime(e.date, e.date_only)],
				[__("Event"), (e) => amPill(__(e.event), AM_INDICATOR[e.event] || (e.event === "Assigned" ? "blue" : e.event === "Returned" ? "gray" : "gray"))],
				[__("Employee"), (e) => (e.event === "Transferred" ? `${who(e.from_employee, e.from_employee_name)} → <b>${who(e.to_employee, e.to_employee_name)}</b>`
					: e.event === "Returned" ? who(e.from_employee, e.from_employee_name) : who(e.to_employee, e.to_employee_name)) || `<span class="text-muted">—</span>`],
				[__("Location"), (e) => (e.from_location ? `${amEsc(e.from_location)} → <b>${amEsc(e.to_location)}</b>` : amEsc(e.to_location || "—"))],
				[__("Condition"), (e) => amStars(e.condition)],
				[__("Acknowledgement"), (e) => amAck(e.acknowledgement_status) || ""],
				[__("Asset Movement"), (e) => `<a href="/app/asset-movement/${encodeURIComponent(e.movement)}" class="text-muted am-no-go">${amEsc(e.movement)}</a>`],
			], d.timeline || [], { empty: __("No movements yet.") }), { cls: "am-moves" })}`);
		this.bindActs();
	}
	async onAct(act, el) {
		if (act === "spec-fields") return this.app.specFieldsDialog(el.dataset.s, () => this.reload());
		if (act === "ack-resend") {
			const r = await this.api("resend_acknowledgement", { name: el.dataset.n });
			frappe.show_alert({ message: __("Acknowledgement request resent to {0}", [r.email]), indicator: "green" });
			return this.reload();
		}
		if (act === "ack-link") {
			frappe.utils.copy_to_clipboard(await this.api("acknowledgement_link", { name: el.dataset.n }));
		}
	}
}

// ------------------------------------------------------------------ catalogue: categories > sub-categories > items

class AmCatalogueView extends AmView {
	async render(token) {
		const res = await this.api("catalogue");
		if (this.app.stale(token)) return;
		const cats = (this.cats = res.categories);
		const types = res.types || [];
		amSetTypeColours(types);
		const w = this.boot.can_write;
		const canType = this.boot.can_add_type;
		if (!this.headed) {
			this.headed = true;
			this.page.set_title(__("Asset Catalogue"));
			if (w) this.page.set_primary_action(__("New Asset Category"), () => this.newCategory(), "add");
			if (canType) this.page.add_inner_button(__("New Category Type"), () => this.newType());
		}
		const edit = (doctype, name) => this.btn(__("Edit"), "open", { data: { dt: doctype, n: name } });
		this.$body.html(`
			<p class="text-muted">${__("Standard ERPNext records: Asset Category › Item Group (sub-category) › Fixed Asset Item › Asset (e.g. IT Hardware › Laptop › Macbook Air M1 › Macbook Air M1 - 001). Buttons open the standard forms.")}</p>
			${this.card(__("Category Types"), this.table([
				[__("Type"), (t) => amPill(t.name)],
				[__("Behaves Like"), (t) => (t.is_subscription ? __("Subscription (renewal date, billing cycle, monthly cost)") : __("Hardware (purchase value, warranty)"))],
				[__("Asset Categories"), (t) => t.categories, { right: true }],
				["", (t) => edit("Asset Category Type", t.name), { right: true }],
			], types, { empty: __("No Category Types yet.") }), {
				count: __("{0} type(s)", [types.length]),
				actions: canType ? this.btn(__("+ Category Type"), "add-type") : "",
			})}
			${cats.length ? cats.map((c) => this.card(`${amEsc(c.name)} ${amPill(c.category_type || "Hardware")}`,
				c.subs.length ? c.subs.map((s) => `
					<div class="am-sub-head">
						<b>${amEsc(s.name)} <span class="text-muted small">${__("{0} item(s)", [s.items.length])}</span></b>
						<div class="am-actions">${this.boot.can_edit_fields ? this.btn(s.spec_fields ? __("Fields ({0})", [s.spec_fields]) : __("+ Fields"), "spec-fields", { data: { s: s.name } }) + " " : ""}${w ? this.btn(__("+ Item"), "add-item", { data: { s: s.name, c: c.name } }) + " " : ""}${edit("Item Group", s.name)}</div>
					</div>
					${this.table([
						[__("Item"), (it) => `<a href="#" data-act="item-assets" data-n="${amEsc(it.name)}" data-c="${amEsc(c.name)}" data-s="${amEsc(s.name)}">${amEsc(it.item_name || it.name)}</a>`],
						[__("Brand"), (it) => amEsc(it.brand || "—")],
						[__("Assets"), (it) => `<b>${it.total}</b>`, { right: true }],
						[__("Assigned"), (it) => it.assigned, { right: true }],
						[__("Available"), (it) => it.available, { right: true }],
						["", (it) => `${w ? this.btn(__("+ Asset"), "add-asset", { data: { n: it.name } }) + " " : ""}${this.boot.can_bulk_create ? this.btn(__("Bulk"), "bulk-asset", { data: { n: it.name } }) + " " : ""}${edit("Item", it.name)}`, { right: true }],
					], s.items, { empty: __("No fixed asset items yet.") })}`).join("")
				: amEmpty(__("No sub-categories yet. A sub-category is an Item Group under “{0}”.", [c.name])),
				{
					count: __("{0} sub-categories · {1} assets", [c.subs.length, c.subs.reduce((n, s) => n + s.items.reduce((m, it) => m + it.total, 0), 0)]),
					actions: `${w ? this.btn(__("+ Sub-Category"), "add-sub", { data: { c: c.name } }) + " " : ""}${edit("Asset Category", c.name)}`,
				})).join("")
			: this.card(__("No Asset Categories yet"), amEmpty(__("Add one to start, for example “IT Hardware” or “Subscriptions”.")),
				{ actions: w ? this.btn(__("+ Asset Category"), "add-category") : "" })}`);
		this.bindActs();
	}
	/** A dialog that creates a standard record through `method`, then refreshes the catalogue and the page filters. */
	quickCreate(title, fields, method, toArgs, done) {
		const d = new frappe.ui.Dialog({
			title,
			fields,
			primary_action_label: __("Create"),
			primary_action: async (v) => {
				d.disable_primary_action();
				try {
					const name = await this.api(method, toArgs(v));
					d.hide();
					frappe.show_alert({ message: done(name), indicator: "green" });
					// new categories / sub-categories also show in the other pages' filters
					const b = await this.api("boot");
					Object.assign(this.app.boot, { categories: b.categories, sub_categories: b.sub_categories });
					this.reload();
				} finally {
					d.enable_primary_action();
				}
			},
		});
		d.show();
		return d;
	}
	async newCategory() {
		const defaults = await this.api("category_defaults", { category_type: "Hardware" });
		const d = this.quickCreate(__("New Asset Category"), [
			{ fieldtype: "Data", fieldname: "category_name", label: __("Category Name"), reqd: 1, description: __("e.g. IT Hardware, Furniture, Software") },
			{ fieldtype: "Link", fieldname: "category_type", label: __("Category Type"), options: "Asset Category Type", reqd: 1, default: "Hardware",
				get_query: () => ({ filters: { disabled: 0 } }),
				onchange: async () => {
					const t = d.get_value("category_type");
					if (!t) return;
					const r = await this.api("category_defaults", { category_type: t });
					d.set_value("fixed_asset_account", r.fixed_asset_account || "");
				} },
			{ fieldtype: "Section Break", label: __("Accounting"), collapsible: 1 },
			{ fieldtype: "Link", fieldname: "company", label: __("Company"), options: "Company", reqd: 1, default: defaults.company, read_only: 1 },
			{ fieldtype: "Link", fieldname: "fixed_asset_account", label: __("Fixed Asset Account"), options: "Account", default: defaults.fixed_asset_account,
				get_query: () => ({ filters: { company: d.get_value("company"), account_type: "Fixed Asset", is_group: 0 } }),
				description: __("Prefilled from a category of the same type. Depreciation accounts are taken the same way.") },
		], "create_category", (v) => ({ data: v }), (name) => __("Asset Category {0} created", [name]));
	}
	newSubCategory(category) {
		this.quickCreate(__("New Sub-Category in {0}", [category]), [
			{ fieldtype: "Data", fieldname: "sub_category", label: __("Sub-Category Name"), reqd: 1, description: __("e.g. Laptop, Monitor, Chair. Saved as an Item Group under “{0}”.", [category]) },
		], "create_sub_category", (v) => ({ category, sub_category: v.sub_category }), (name) => __("Sub-Category {0} created", [name]));
	}
	newItem(category, subCategory) {
		const d = this.quickCreate(__("New Item in {0} › {1}", [category, subCategory]), [
			{ fieldtype: "Data", fieldname: "item_name", label: __("Item Name"), reqd: 1, description: __("e.g. Macbook Air M1. Assets of it are named “Macbook Air M1 - 001”, “- 002”, …"),
				onchange: () => !d.get_value("item_code") && d.set_value("item_code", d.get_value("item_name")) },
			{ fieldtype: "Data", fieldname: "item_code", label: __("Item Code"), description: __("Defaults to the item name.") },
			{ fieldtype: "Column Break" },
			{ fieldtype: "Data", fieldname: "brand", label: __("Brand"), description: __("Created if it doesn't exist.") },
			{ fieldtype: "Section Break" },
			{ fieldtype: "Small Text", fieldname: "description", label: __("Description") },
		], "create_item", (v) => ({ data: { ...v, category, sub_category: subCategory } }), (name) => __("Item {0} created", [name]));
	}
	newType() {
		this.app.newTypeDialog(() => this.reload());
	}
	async onAct(act, el) {
		const n = el.dataset.n;
		if (act === "add-type") this.newType();
		else if (act === "add-category") this.newCategory();
		else if (act === "open") frappe.set_route("Form", el.dataset.dt, n);
		else if (act === "add-sub") {
			this.newSubCategory(el.dataset.c);
		} else if (act === "add-item") {
			this.newItem(el.dataset.c, el.dataset.s);
		} else if (act === "add-asset") {
			frappe.new_doc("Asset", { item_code: n });
		} else if (act === "bulk-asset") {
			this.app.bulkCreateDialog(n);
		} else if (act === "spec-fields") {
			this.app.specFieldsDialog(el.dataset.s, () => this.reload());
		} else if (act === "item-assets") {
			this.app._assetFilters = { search: n, category: el.dataset.c, sub_category: el.dataset.s, status: "" };
			this.app.go("assets");
		}
	}
}

// ------------------------------------------------------------------ hand-over acknowledgements

class AmAcksView extends AmView {
	constructor(app) {
		super(app);
		this.filters = Object.assign({ search: "", status: "Pending" }, app._ackFilters || {});
	}
	async render(token) {
		if (!this.controls) {
			this.page.set_title(__("Acknowledgements"));
			this.page.add_inner_button(__("Settings"), () => this.app.go("settings"));
			this.controls = this.addFilters([
				{ fieldtype: "Data", fieldname: "search", label: __("Search employee, asset, serial no or record"), default: this.filters.search },
				{ fieldtype: "Select", fieldname: "status", label: __("Status"), default: this.filters.status,
					options: [{ value: "", label: __("All Statuses") }, ...["Pending", "Completed", "Cancelled"].map((s) => ({ value: s, label: __(s) }))] },
			], (key, value) => {
				this.filters[key] = value || "";
				this.reload();
			});
		}
		const d = (this.data = await this.api("acknowledgements", this.filters));
		if (this.app.stale(token)) return;
		this.app._ackFilters = this.filters;
		const c = d.counts;
		const total = Object.values(c).reduce((a, b) => a + b, 0);
		const pending = (r) => r.status === "Pending";
		this.$body.html(`
			${this.boot.ack_enabled ? "" : `<div class="alert alert-warning">${__("Acknowledgement emails are turned off, so new hand-overs don't ask for one.")} <a href="#" data-go="settings">${__("Turn on in Settings")} →</a></div>`}
			${this.numberCards([
				{ label: __("Pending"), value: c.Pending || 0, color: "orange", act: "status", s: "Pending" },
				{ label: __("Completed"), value: c.Completed || 0, color: "green", act: "status", s: "Completed" },
				{ label: __("Cancelled"), value: c.Cancelled || 0, act: "status", s: "Cancelled" },
				{ label: __("All"), value: total, act: "status", s: "" },
			])}
			${this.card(__("Hand-over Acknowledgements"), this.table([
				[__("Employee"), (r) => `${amLink(`employee|${r.employee}`, r.employee_name || r.employee)}${amMuted(r.email || __("no email address"))}`],
				[__("Assets"), (r) => `<div class="am-tags">${r.assets.map((a) => `<span title="${amEsc(a.serial_no || "")}">${amPill(a.asset, "blue")}</span>`).join("")}</div>`],
				[__("Handed Over"), (r) => `${amDate(r.assigned_on)}${amMuted(r.movement_purpose || "")}`],
				[__("Sent"), (r) => (r.sent_count ? `${__("{0}×", [r.sent_count])}${amMuted(__("last {0}", [frappe.datetime.str_to_user(String(r.last_sent_on || r.sent_on || ""))]))}` : `<span class="text-muted">${__("not sent")}</span>`)],
				[__("Status"), (r) => `${amPill(__(r.status), AM_INDICATOR[r.status])}${r.acknowledged_on ? amMuted(`${frappe.datetime.str_to_user(String(r.acknowledged_on))}${r.acknowledged_ip ? " · " + r.acknowledged_ip : ""}`) : ""}`],
				[__("Employee Remarks"), (r) => (r.employee_remarks ? `<div class="small" style="max-width:280px;white-space:pre-wrap">${amEsc(r.employee_remarks)}</div>` : `<span class="text-muted">—</span>`)],
				["", (r) => (pending(r) && d.can_resend ? `${this.btn(__("Resend"), "resend", { data: { n: r.name } })} ${this.btn(__("Copy Link"), "link", { data: { n: r.name } })}` : `<a href="/app/asset-acknowledgement/${encodeURIComponent(r.name)}" class="text-muted small am-no-go">${amEsc(r.name)}</a>`), { right: true }],
			], d.rows, { empty: this.filters.status === "Pending" ? __("Nothing waiting: every hand-over is acknowledged.") : __("No acknowledgements match.") }), { count: d.rows.length })}
			<p class="text-muted small">${__("Assigning or transferring an asset to an employee emails them a link (CC the IT team). They confirm on a simple page without logging in; the time, network address and browser are kept as proof.")}</p>`);
		this.$(".number-widget-box[data-act=status]").each((_, el) => el.classList.toggle("am-on", el.dataset.s === this.filters.status));
		this.bindActs();
	}
	async onAct(act, el) {
		if (act === "status") {
			this.filters.status = el.dataset.s;
			this.controls.status.set_input(this.filters.status);
			return this.reload();
		}
		if (act === "resend") {
			el.disabled = true;
			try {
				const r = await this.api("resend_acknowledgement", { name: el.dataset.n });
				frappe.show_alert({ message: __("Resent to {0}", [r.email]), indicator: "green" });
				this.reload();
			} finally {
				el.disabled = false;
			}
		} else if (act === "link") {
			frappe.utils.copy_to_clipboard(await this.api("acknowledgement_link", { name: el.dataset.n }));
		}
	}
}

// ------------------------------------------------------------------ settings (Asset Management Settings, naming, specifications, masters)

class AmSettingsView extends AmView {
	async render(token) {
		const d = (this.data = await this.api("settings_page"));
		if (this.app.stale(token)) return;
		const s = d.settings;
		const can = d.can_write;
		if (!this.headed) {
			this.headed = true;
			this.page.set_title(__("Settings"));
			if (can) this.page.set_primary_action(__("Save Settings"), () => this.save(), "check");
			this.page.add_inner_button(__("Settings Form"), () => frappe.set_route("Form", "Asset Management Settings"));
		}
		const code = (t) => `<code>${amEsc(t)}</code>`;
		const seriesHtml = d.series.map((sr, i) => {
			const first = sr.counters[0];
			const example = first ? first.next : sr.per_model ? __("e.g. Macbook Air M1 - 001 (no models yet)") : "";
			return `<div class="am-sub-head">
					<div><b>${code(sr.series)}</b> ${sr.default ? amPill(__("Default"), "green") : ""}
						<div class="text-muted small">${sr.per_model ? __("A counter per model. Next: {0}", [amEsc(example)]) : __("Next: {0}", [amEsc(example)])}</div></div>
					<div class="am-actions">${can && !sr.default ? `${this.btn(__("Make Default"), "series-default", { data: { i } })} ${this.btn(__("Remove"), "series-remove", { data: { i } })}` : ""}</div>
				</div>
				${sr.counters.length ? this.table([
					[sr.per_model ? __("Model") : __("Prefix"), (c) => amEsc(c.label)],
					[__("Current Number"), (c) => `<b>${c.current}</b>`, { right: true }],
					[__("Next Name"), (c) => code(c.next)],
					[__("Assets"), (c) => c.assets, { right: true }],
					...(can ? [["", (c) => this.btn(__("Set"), "series-set", { data: { p: c.prefix, c: c.current } }), { right: true }]] : []),
				], sr.counters) : ""}`;
		}).join("");
		this.$body.html(`
			${this.card(__("General"), `<div class="am-settings-form"></div>
				<p class="text-muted small" style="margin-top:var(--margin-sm)">${d.email_account
					? __("Emails go out from {0} (the default outgoing Email Account).", [`<b>${amEsc(d.email_account)}</b>`])
					: `<span style="color:var(--red-600)">${__("No outgoing Email Account is set up, so acknowledgement emails can't be sent.")}</span>`}</p>`)}
			${this.card(__("Asset Naming"), `
				<p class="text-muted">${__("How new assets are named. {0} gives a counter per model (Macbook Air M1 - 001); {1} gives one running number (ACC-ASS-2026-00001). The default is used for new assets, including Bulk Create.", [code(".{item_name}. - .###"), code("ACC-ASS-.YYYY.-")])}</p>
				${seriesHtml}
				${can ? `<div class="am-sub-head"><div class="am-series-add" style="flex:1;max-width:420px"></div><div class="am-actions">${this.btn(__("Add Series"), "series-add")}</div></div>` : ""}`)}
			${this.card(__("Specification Fields"), this.table([
				[__("Sub-Category"), (x) => `<b>${amEsc(x.name)}</b>${amMuted(x.category)}`],
				[__("Fields"), (x) => (x.fields.length ? `<div class="am-tags">${x.fields.map((f) => amPill(`${f.field_label}${f.mandatory ? " *" : ""} · ${__(f.field_type)}${f.per_unit ? " · " + __("per unit") : ""}`, f.per_unit ? "purple" : "blue")).join("")}</div>` : `<span class="text-muted">${__("None")}</span>`)],
				[__("Assets"), (x) => x.assets, { right: true }],
				...(this.boot.can_edit_fields ? [["", (x) => this.btn(x.fields.length ? __("Edit") : __("+ Fields"), "spec", { data: { s: x.name } }), { right: true }]] : []),
			], d.sub_categories, { empty: __("No sub-categories yet. Add them in Catalogue.") }), { count: d.sub_categories.length })}
			<div class="am-grid">
				${this.card(__("Category Types"), this.table([
					[__("Type"), (t) => amPill(t.name, t.color)],
					[__("Behaves Like"), (t) => (t.is_subscription ? __("Subscription") : __("Hardware"))],
					[__("Categories"), (t) => t.categories, { right: true }],
					["", (t) => this.btn(__("Edit"), "open", { data: { dt: "Asset Category Type", n: t.name } }), { right: true }],
				], d.types, { empty: __("No Category Types. Add one before creating a category.") }), {
					count: d.types.length, actions: this.boot.can_add_type ? this.btn(__("+ Category Type"), "add-type") : "" })}
				${this.card(__("Locations"), this.table([
					[__("Location"), (l) => `<b>${amEsc(l.name)}</b>${l.name === s.default_location ? " " + amPill(__("Default"), "green") : ""}`],
					[__("Assets"), (l) => l.assets, { right: true }],
					["", (l) => this.btn(__("Edit"), "open", { data: { dt: "Location", n: l.name } }), { right: true }],
				], d.locations, { empty: __("No locations yet.") }), { count: d.locations.length, actions: this.btn(__("+ Location"), "add-location") })}
			</div>`);
		this.form = new frappe.ui.FieldGroup({
			body: this.$(".am-settings-form")[0],
			fields: [
				{ fieldtype: "Section Break", label: __("Hand-over Acknowledgement") },
				{ fieldtype: "Check", fieldname: "send_acknowledgement", label: __("Ask employees to acknowledge assets"),
					description: __("Email the employee a link when an asset is assigned or transferred to them.") },
				{ fieldtype: "Small Text", fieldname: "it_team_emails", label: __("IT Team Emails (CC)"), description: __("Comma separated. Copied on every request and told when it is acknowledged.") },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Small Text", fieldname: "acknowledgement_message", label: __("Message to the Employee") },
				{ fieldtype: "Section Break", label: __("Hand-over & Defaults") },
				{ fieldtype: "Check", fieldname: "require_condition_rating", label: __("Condition rating (stars) required at hand-over") },
				{ fieldtype: "Link", fieldname: "default_location", label: __("Default Location for New Assets"), options: "Location" },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Int", fieldname: "expiry_alert_days", label: __("Warranty / Renewal Alert (days)"), description: __("Ending within this many days is flagged.") },
			],
		});
		this.form.make();
		this.form.set_values({ ...s, send_acknowledgement: s.send_acknowledgement ? 1 : 0, require_condition_rating: s.require_condition_rating ? 1 : 0 });
		if (!can) this.form.fields.forEach((f) => f.df && (f.df.read_only = 1) && f.refresh && f.refresh());
		if (can) {
			this.newSeries = frappe.ui.form.make_control({
				parent: this.$(".am-series-add")[0],
				df: { fieldtype: "Data", fieldname: "new_series", placeholder: __("New series, e.g. IT-.YYYY.-.#### or .{item_name}. - .###") },
				render_input: true,
			});
		}
		this.bindActs();
	}
	/** Refresh what the other tabs read from boot. */
	async rebootSettings() {
		const b = await this.api("boot");
		Object.assign(this.boot, {
			ack_enabled: b.ack_enabled, require_rating: b.require_rating, expiry_alert_days: b.expiry_alert_days, default_location: b.default_location,
		});
	}
	async save() {
		const v = this.form.get_values(true) || {};
		await this.api("save_settings", { data: {
			send_acknowledgement: v.send_acknowledgement ? 1 : 0, it_team_emails: v.it_team_emails || "", acknowledgement_message: v.acknowledgement_message || "",
			require_condition_rating: v.require_condition_rating ? 1 : 0, default_location: v.default_location || "", expiry_alert_days: v.expiry_alert_days || 0,
		} });
		await this.rebootSettings();
		frappe.show_alert({ message: __("Settings saved"), indicator: "green" });
		this.reload();
	}
	/** Change the list of series / the default, saved at once. */
	async saveSeries(list, def) {
		await this.api("save_settings", { data: { naming_series_options: list.join("\n"), default_naming_series: def } });
		frappe.show_alert({ message: __("Asset naming updated"), indicator: "green" });
		this.reload();
	}
	async onAct(act, el) {
		const series = this.data.series.map((x) => x.series);
		const def = (this.data.series.find((x) => x.default) || {}).series || series[0];
		if (act === "series-default") return this.saveSeries(series, series[+el.dataset.i]);
		if (act === "series-remove") {
			const gone = series[+el.dataset.i];
			return frappe.confirm(__("Stop offering {0} for new assets? Existing assets keep their names.", [`<code>${amEsc(gone)}</code>`]),
				() => this.saveSeries(series.filter((x) => x !== gone), def));
		}
		if (act === "series-add") {
			const value = (this.newSeries.get_value() || "").trim();
			if (!value) return frappe.msgprint(__("Type the new series first."));
			if (series.includes(value)) return frappe.msgprint(__("{0} is already in the list.", [value]));
			return this.saveSeries([...series, value], def);
		}
		if (act === "series-set") {
			const prefix = el.dataset.p;
			return frappe.prompt(
				[{ fieldtype: "Int", fieldname: "current", label: __("Current Number"), default: +el.dataset.c, reqd: 1,
					description: __("The last number used. The next asset gets this + 1. It can't go below the highest existing asset of {0}.", [prefix]) }],
				async (v) => {
					this.data = await this.api("set_series_counter", { prefix, current: v.current });
					frappe.show_alert({ message: __("{0} continues after {1}", [prefix, v.current]), indicator: "green" });
					this.reload();
				},
				__("Set Counter: {0}", [prefix]), __("Set"),
			);
		}
		if (act === "spec") return this.app.specFieldsDialog(el.dataset.s, () => this.reload());
		if (act === "add-type") return this.app.newTypeDialog(() => this.reload());
		if (act === "open") return frappe.set_route("Form", el.dataset.dt, el.dataset.n);
		if (act === "add-location") {
			return frappe.prompt([{ fieldtype: "Data", fieldname: "location_name", label: __("Location Name"), reqd: 1 }], async (v) => {
				await this.api("create_location", { location_name: v.location_name });
				frappe.show_alert({ message: __("Location {0} created", [v.location_name]), indicator: "green" });
				this.reload();
			}, __("New Location"), __("Create"));
		}
	}
}

// ------------------------------------------------------------------ reports (standard report look: filters, number cards, chart, DataTable)

class AmReportsView extends AmView {
	constructor(app, name) {
		super(app, name);
		this.key = name || app._reportKey || "employee_cost";
		this.filters = Object.assign({ category: "", department: "", holding: "yes", months: "12", date_from: "", date_to: "" }, app._reportFilters || {});
	}
	async render(token) {
		const [list, d] = await Promise.all([
			this.app._reportList || this.api(AM_API_REPORTS + "report_list"),
			this.api(AM_API_REPORTS + "report", { key: this.key, filters: this.filters }),
		]);
		if (this.app.stale(token)) return;
		this.app._reportList = list;
		this.app._reportKey = this.key;
		this.app._reportFilters = this.filters;
		this.data = d;
		if (!this.controls) this.makeControls(list, d);
		this.page.set_title(d.title);
		this.$body.html(`
			<p class="text-muted">${amEsc(d.description)}</p>
			${this.numberCards(d.summary.map((t) => ({ label: t.label, value: this.fmt(t.type, t.value), color: { red: "red", lime: "green", lav: "purple", purple: "purple" }[t.tone] })))}
			${d.chart && d.chart.rows.length ? this.card(amEsc(d.chart.title),
				`${["employee_cost", "department_cost"].includes(this.key) ? `<p class="text-muted small">${__("Monthly cost = subscriptions per month + hardware value spread over {0} months", [d.hw_life_months])}</p>` : ""}<div class="am-report-chart"></div>`) : ""}
			${this.card(__("Details"), `<div class="am-datatable"></div>`, { count: d.rows.length })}`);
		this.drawChart();
		this.drawTable();
	}
	makeControls(list, d) {
		this.page.add_inner_button(__("Export Excel"), () => this.exportExcel());
		const opt = (v, l) => ({ value: v, label: l });
		const has = (k) => d.filters.includes(k);
		const defs = [{ fieldtype: "Select", fieldname: "report", label: __("Report"), default: this.key, options: list.map((r) => opt(r.key, r.title)) }];
		if (has("category")) defs.push({ fieldtype: "Select", fieldname: "category", label: __("Category"), options: this.categoryOptions(), default: this.filters.category });
		if (has("department")) defs.push({ fieldtype: "Select", fieldname: "department", label: __("Department"), default: this.filters.department,
			options: [opt("", __("All Departments")), ...d.departments.map((x) => opt(x, amDept(x)))] });
		if (has("holding")) defs.push({ fieldtype: "Select", fieldname: "holding", label: __("Employees"), default: this.filters.holding,
			options: [opt("yes", __("Employees holding assets")), opt("all", __("All active employees"))] });
		if (has("months")) defs.push({ fieldtype: "Select", fieldname: "months", label: __("Window"), default: this.filters.months,
			options: [opt("1", __("Next 1 month")), opt("3", __("Next 3 months")), opt("6", __("Next 6 months")), opt("12", __("Next 12 months")), opt("24", __("Next 24 months"))] });
		if (has("dates")) defs.push(
			{ fieldtype: "Date", fieldname: "date_from", label: __("Assigned From"), default: this.filters.date_from },
			{ fieldtype: "Date", fieldname: "date_to", label: __("Assigned To"), default: this.filters.date_to },
		);
		this.controls = this.addFilters(defs, (key, value) => {
			if (key === "report") {
				if (value && value !== this.key) {
					this.app._reportKey = value;
					this.app.go("reports", value);
				}
				return;
			}
			this.filters[key] = value || "";
			this.reload();
		});
	}
	fmt(type, v) {
		if (v == null || v === "") return type === "date" ? `<span class="text-muted">—</span>` : "";
		switch (type) {
			case "money": return amInr(v);
			case "int": return Math.round(v).toLocaleString("en-IN");
			case "dec": return Number(v).toFixed(1);
			case "pct": return `${Math.round(v)}%`;
			case "date": return amDate(v);
			case "dept": return amEsc(amDept(v));
			case "status": return amPill(v);
			case "bar": return `<div class="am-share"><div class="progress"><div class="progress-bar" style="width:${Math.min(Math.max(v, 0), 100)}%"></div></div><span class="small">${Math.round(v)}%</span></div>`;
			case "days": return v < 0 ? `<span class="am-days-late">${__("{0} days ago", [-v])}</span>` : __("in {0} days", [v]);
			default: return amEsc(v);
		}
	}
	drawChart() {
		const chart = this.data.chart;
		const el = this.$(".am-report-chart")[0];
		if (!el) return;
		new frappe.Chart(el, {
			type: "bar",
			height: 260,
			colors: ["#2490ef"],
			barOptions: { spaceRatio: 0.4 },
			axisOptions: { xIsSeries: false, xAxisMode: "tick" },
			tooltipOptions: { formatTooltipY: (v) => (chart.type === "money" ? amInr(v) : String(v)) },
			data: { labels: chart.rows.map((r) => amDept(r.label) || "—"), datasets: [{ name: chart.title, values: chart.rows.map((r) => r.value) }] },
		});
	}
	drawTable() {
		const d = this.data;
		const el = this.$(".am-datatable")[0];
		if (!d.rows.length) {
			el.innerHTML = amEmpty(d.empty || __("No data for these filters."));
			return;
		}
		const num = (c) => ["money", "int", "dec", "pct", "days"].includes(c.type);
		const byId = {};
		const columns = d.columns.map((c, i) => {
			byId[c.key] = c;
			return {
				id: c.key,
				name: c.label,
				editable: false,
				dropdown: true,
				align: num(c) ? "right" : "left",
				width: i === 0 ? 200 : c.type === "bar" ? 150 : num(c) ? 130 : c.type === "date" ? 110 : 170,
				format: (value, row, column, data) => {
					let html = this.fmt(c.type, value);
					if (i === 0 && data && data._go) html = `<a href="#" data-go="${amEsc(data._go)}">${html}</a>`;
					if (c.tone === "neg" && value) html = `<span class="am-days-late">${html}</span>`;
					const sub = c.sub && data && data[c.key + "_sub"];
					return sub ? `${html} <span class="text-muted">· ${amEsc(sub)}</span>` : html;
				},
			};
		});
		this.datatable = new frappe.DataTable(el, {
			columns,
			data: d.rows,
			layout: "fixed", // real column widths with horizontal scroll, as in standard query reports
			inlineFilters: true,
			serialNoColumn: true,
			checkboxColumn: false,
			cellHeight: 36,
			noDataMessage: __("No data for these filters."),
			showTotalRow: d.columns.some((c) => c.total),
			hooks: {
				columnTotal: (values, column) => {
					const c = byId[column.id];
					if (!c) return "";
					if (c.total) return values.reduce((a, v) => a + (Number(v) || 0), 0);
					return column.id === d.columns[0].key ? __("Total") : "";
				},
			},
		});
	}
	exportExcel() {
		const d = this.data;
		// export what the table shows (honours the DataTable's inline filters and sort)
		const visible = this.datatable && this.datatable.bodyRenderer.visibleRowIndices; // same source the standard query report uses
		const shown = visible ? visible.map((i) => d.rows[i]).filter(Boolean) : d.rows;
		const header = [];
		d.columns.forEach((c) => {
			header.push(c.label);
			if (c.sub) header.push(c.label + " (detail)");
		});
		const cell = (c, v) => {
			if (v == null || v === "") return "";
			if (["money", "int", "dec", "days"].includes(c.type)) return Math.round(Number(v) * 100) / 100;
			if (c.type === "pct" || c.type === "bar") return { v: Number(v) / 100 };
			if (c.type === "date") return String(v).slice(0, 10);
			if (c.type === "dept") return amDept(v);
			return String(v);
		};
		const out = shown.map((r) => {
			const line = [];
			d.columns.forEach((c) => {
				line.push(cell(c, r[c.key]));
				if (c.sub) line.push(r[c.key + "_sub"] || "");
			});
			return line;
		});
		amDownload(amXlsx(d.title, header, out), `${d.title} ${frappe.datetime.get_today()}.xlsx`);
		frappe.show_alert({ message: __("Downloaded {0} row(s) to Excel.", [out.length]), indicator: "green" });
	}
}

// ------------------------------------------------------------------ Excel (minimal .xlsx writer, no library needed)

function amZip(files) {
	const table = amZip.t || (amZip.t = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	}));
	const crc32 = (d) => {
		let c = 0xffffffff;
		for (let i = 0; i < d.length; i++) c = table[(c ^ d[i]) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const enc = new TextEncoder();
	const now = new Date();
	const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
	const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
	const parts = [];
	const central = [];
	let offset = 0;
	for (const f of files) {
		const name = enc.encode(f.name);
		const data = enc.encode(f.data);
		const crc = crc32(data);
		const local = new DataView(new ArrayBuffer(30));
		[[0, 0x04034b50, 4], [4, 20], [6, 0x0800], [8, 0], [10, time], [12, date], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length], [28, 0]]
			.forEach(([at, v, size]) => (size === 4 ? local.setUint32(at, v, true) : local.setUint16(at, v, true)));
		parts.push(new Uint8Array(local.buffer), name, data);
		const cen = new DataView(new ArrayBuffer(46));
		[[0, 0x02014b50, 4], [4, 20], [6, 20], [8, 0x0800], [10, 0], [12, time], [14, date], [16, crc, 4], [20, data.length, 4], [24, data.length, 4],
			[28, name.length], [30, 0], [32, 0], [34, 0], [36, 0], [38, 0, 4], [42, offset, 4]]
			.forEach(([at, v, size]) => (size === 4 ? cen.setUint32(at, v, true) : cen.setUint16(at, v, true)));
		central.push(new Uint8Array(cen.buffer), name);
		offset += 30 + name.length + data.length;
	}
	const size = central.reduce((a, p) => a + p.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, files.length, true);
	end.setUint16(10, files.length, true);
	end.setUint32(12, size, true);
	end.setUint32(16, offset, true);
	return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** One-sheet .xlsx: bold frozen header, sized columns; cells are numbers, strings or {v} percentages. */
function amXlsx(sheetName, header, rows) {
	const esc = (v) => String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const col = (i) => {
		let s = "";
		for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
		return s;
	};
	const all = [header, ...rows];
	const shown = (v) => (v && typeof v === "object" ? String(v.v) : String(v ?? ""));
	const widths = header.map((_, c) => Math.min(60, Math.max(9, ...all.map((r) => shown(r[c]).length + 2))));
	const cell = (v, r, c) => {
		const ref = col(c) + (r + 1);
		if (r === 0) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${esc(v)}</t></is></c>`;
		if (v && typeof v === "object") return `<c r="${ref}" s="2"><v>${v.v}</v></c>`;
		if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
		if (v == null || v === "") return "";
		return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
	};
	const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
	const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
	const name = esc((sheetName || "Sheet1").replace(/[\[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1");
	return amZip([
		{ name: "[Content_Types].xml", data: head + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
		{ name: "_rels/.rels", data: head + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
		{ name: "xl/workbook.xml", data: head + `<workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
		{ name: "xl/_rels/workbook.xml.rels", data: head + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
		{ name: "xl/styles.xml", data: head + `<styleSheet ${ns}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>` },
		{ name: "xl/worksheets/sheet1.xml", data: head + `<worksheet ${ns}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${all.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci)).join("")}</row>`).join("")}</sheetData></worksheet>` },
	]);
}

function amDownload(blob, filename) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
