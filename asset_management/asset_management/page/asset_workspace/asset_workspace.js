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
const amDate = (d) => (d ? frappe.datetime.str_to_user(String(d).slice(0, 10)) : "");
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
};
const AM_STATUSES = ["Available", "Assigned", "Draft", "Under Repair", "Disposed"];
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
	["reports", __("Reports")],
	["catalogue", __("Catalogue")],
];

// Layout only; colours come from the desk theme variables so light and dark mode both work.
const AM_CSS = `
	.am-tabs { margin: 0 0 var(--margin-md); }
	.am-tabs .form-tabs { border-bottom: 1px solid var(--border-color); }
	.am-body { padding: 0 var(--padding-md) var(--padding-xl); }
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
		this.ready = frappe.xcall(AM_API + "boot").then((b) => (this.boot = b));
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

	/** Assign one or more assets to an employee: a standard Asset Movement (Issue). Pass `employee` to fix the employee. */
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
			{ fieldtype: "Link", fieldname: "employee", label: __("Employee"), options: "Employee", reqd: 1, default: employee, get_query: () => ({ filters: { status: "Active" } }) },
			{ fieldtype: "Date", fieldname: "assigned_on", label: __("Assigned On"), reqd: 1, default: this.boot.today },
			{ fieldtype: "HTML", fieldname: "note", options: `<p class="text-muted small">${__("Creates and submits a standard Asset Movement (Issue), which sets the asset's Custodian.")}</p>` },
		);
		const d = new frappe.ui.Dialog({
			title: assets.length > 1 ? __("Assign {0} Assets", [assets.length]) : __("Assign Asset"),
			fields,
			primary_action_label: __("Assign"),
			primary_action: async (v) => {
				const names = assets.length ? assets : [v.asset];
				d.disable_primary_action();
				try {
					const r = await this.api("assign", { assets: names, employee: v.employee, assigned_on: v.assigned_on });
					d.hide();
					frappe.show_alert({ message: __("{0} assigned to {1} ({2})", [names.length === 1 ? names[0] : __("{0} assets", [names.length]), r.employee_name || v.employee, r.movements.join(", ")]), indicator: "green" }, 6);
					(onDone || (() => this.refresh()))();
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
				{ fieldtype: "Date", fieldname: "returned_on", label: __("Returned On"), reqd: 1, default: this.boot.today },
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
		const cls = days < 0 ? "am-days-late" : days <= 45 ? "am-days-near" : "";
		const note = days < 0 ? __("{0}d overdue", [-days]) : days <= 45 ? __("in {0}d", [days]) : "";
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
					[__("Since"), (r) => amDate(r.assigned_on)],
					...(can ? [["", (r) => this.btn(__("Return"), "return-one", { data: { n: r.name } }), { right: true }]] : []),
				], d.assigned, { scroll: true, empty: filtered ? __("No assets are with employees for these filters.") : __("No assets are with employees.") }), {
					count: d.assigned.length,
					actions: can ? this.btn(__("Return Selected"), "return-picked", { disabled: true }) : "",
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
		[["available", "assign-picked", __("Assign Selected")], ["assigned", "return-picked", __("Return Selected")]].forEach(([key, act, label]) => {
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
		else if (act === "return-one" || act === "return-picked") {
			const names = act === "return-one" ? [el.dataset.n] : [...this.picked.assigned];
			const holders = new Set(this.data.assigned.filter((r) => names.includes(r.name)).map((r) => r.employee_name || r.assigned_to));
			this.app.returnDialog({ assets: names, holder: holders.size === 1 ? [...holders][0] : "", onDone: done });
		}
	}
}

// ------------------------------------------------------------------ employee mapping

class AmEmployeesView extends AmView {
	constructor(app) {
		super(app);
		this.filters = Object.assign({ search: "", department: "", holding: "" }, app._empFilters || {});
	}
	async render(token) {
		if (!this.controls) {
			this.page.set_title(__("Employees"));
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
			], rows, { go: (r) => `employee|${r.name}`, empty: __("No employees match. Employees come from ERPNext's Employee list.") }), { count: rows.length })}`);
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
		const hw = cur.filter((a) => a.category_type !== "Subscription").length;
		if (!this.headed) {
			this.headed = true;
			this.page.set_title(e.employee_name);
			this.page.add_inner_button(__("Employees"), () => this.app.go("employees"));
			this.page.add_inner_button(__("Employee Record"), () => frappe.set_route("Form", "Employee", e.name));
			if (can) this.page.set_primary_action(__("Assign Asset"), () => this.app.assignDialog({ employee: e.name, onDone: () => this.reload() }));
		}
		const info = [e.name, e.designation, amDept(e.department), e.company_email].filter(Boolean).join(" · ");
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
				[__("Warranty / Renewal"), (a) => this.expiryHtml(a)],
				...(can ? [["", (a) => this.btn(__("Return"), "return", { data: { n: a.name } }), { right: true }]] : []),
			], cur, { go: (a) => `asset|${a.name}`, empty: __("{0} holds no assets.", [e.employee_name]) }), {
				count: cur.length,
				actions: can && cur.length > 1 ? this.btn(__("Return All ({0})", [cur.length]), "return-all") : "",
			})}
			${this.card(__("History"), this.table([
				[__("Asset"), (h) => `<div class="bold">${amEsc(h.asset)}</div>${amMuted(h.category || "")}`],
				[__("Assigned"), (h) => amDate(h.assigned_on)],
				[__("Returned"), (h) => amDate(h.returned_on) || `<span class="text-muted">—</span>`],
				[__("Asset Movement"), (h) => `<span class="text-muted">${amEsc(h.movement)}</span>`],
				[__("Status"), (h) => amPill(h.status)],
			], d.history, { go: (h) => `asset|${h.asset}`, empty: __("No assignments yet.") }))}`);
		this.bindActs();
	}
	onAct(act, el) {
		const e = this.data.employee;
		const done = () => this.reload();
		if (act === "return") this.app.returnDialog({ assets: [el.dataset.n], holder: e.employee_name, onDone: done });
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
				[__("Assigned To"), (r) => (r.assigned_to ? `${amEsc(r.employee_name || r.assigned_to)}${amMuted(__("since {0}", [amDate(r.assigned_on)]))}` : `<span class="text-muted">—</span>`)],
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
		const sub = a.category_type === "Subscription";
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
		const kv = (label, value) => `<div class="frappe-control"><label class="control-label">${label}</label><div class="control-value like-disabled-input">${value || "—"}</div></div>`;
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
						<p class="text-muted small" style="margin-top:var(--margin-sm)">${__("Since {0}", [amDate(a.assigned_on)])}</p>`
					: amEmpty(a.status === "Available" ? __("Not assigned. It is ready to hand out.") : __("Not assigned: {0}.", [__(a.status)])))}
			</div>
			${this.card(__("Assignment History"), this.table([
				[__("Employee"), (h) => `<div class="bold">${amEsc(h.employee_name || h.employee)}</div>${amMuted(amDept(h.department) || h.employee)}`],
				[__("Assigned"), (h) => amDate(h.assigned_on)],
				[__("Returned"), (h) => amDate(h.returned_on) || `<span class="text-muted">—</span>`],
				[__("Asset Movement"), (h) => `<span class="text-muted">${amEsc(h.movement)}</span>`],
				[__("Status"), (h) => amPill(h.status)],
			], d.history, { go: (h) => `employee|${h.employee}`, empty: __("Never assigned.") }))}`);
	}
}

// ------------------------------------------------------------------ catalogue: categories > sub-categories > items

class AmCatalogueView extends AmView {
	async render(token) {
		const cats = (this.cats = await this.api("catalogue"));
		if (this.app.stale(token)) return;
		const w = this.boot.can_write;
		if (!this.headed) {
			this.headed = true;
			this.page.set_title(__("Asset Catalogue"));
			if (w) this.page.set_primary_action(__("New Asset Category"), () => frappe.new_doc("Asset Category"), "add");
		}
		const edit = (doctype, name) => this.btn(__("Edit"), "open", { data: { dt: doctype, n: name } });
		this.$body.html(`
			<p class="text-muted">${__("Standard ERPNext records: Asset Category › Item Group (sub-category) › Fixed Asset Item › Asset (e.g. IT Hardware › Laptop › Macbook Air M1 › Macbook Air M1 - 001). Buttons open the standard forms.")}</p>
			${cats.length ? cats.map((c) => this.card(`${amEsc(c.name)} ${amPill(c.category_type || "Hardware")}`,
				c.subs.length ? c.subs.map((s) => `
					<div class="am-sub-head">
						<b>${amEsc(s.name)} <span class="text-muted small">${__("{0} item(s)", [s.items.length])}</span></b>
						<div class="am-actions">${w ? this.btn(__("+ Item"), "add-item", { data: { s: s.name, c: c.name } }) + " " : ""}${edit("Item Group", s.name)}</div>
					</div>
					${this.table([
						[__("Item"), (it) => `<a href="#" data-act="item-assets" data-n="${amEsc(it.name)}" data-c="${amEsc(c.name)}" data-s="${amEsc(s.name)}">${amEsc(it.item_name || it.name)}</a>`],
						[__("Brand"), (it) => amEsc(it.brand || "—")],
						[__("Assets"), (it) => `<b>${it.total}</b>`, { right: true }],
						[__("Assigned"), (it) => it.assigned, { right: true }],
						[__("Available"), (it) => it.available, { right: true }],
						["", (it) => `${w ? this.btn(__("+ Asset"), "add-asset", { data: { n: it.name } }) + " " : ""}${edit("Item", it.name)}`, { right: true }],
					], s.items, { empty: __("No fixed asset items yet.") })}`).join("")
				: amEmpty(__("No sub-categories yet. A sub-category is an Item Group under “{0}”.", [c.name])),
				{
					count: __("{0} sub-categories · {1} assets", [c.subs.length, c.subs.reduce((n, s) => n + s.items.reduce((m, it) => m + it.total, 0), 0)]),
					actions: `${w ? this.btn(__("+ Sub-Category"), "add-sub", { data: { c: c.name } }) + " " : ""}${edit("Asset Category", c.name)}`,
				})).join("")
			: this.card(__("No Asset Categories yet"), amEmpty(__("Add one to start, for example “IT Hardware” or “Subscriptions”.")))}`);
		this.bindActs();
	}
	async onAct(act, el) {
		const n = el.dataset.n;
		if (act === "open") frappe.set_route("Form", el.dataset.dt, n);
		else if (act === "add-sub") {
			await this.api("ensure_category_group", { category: el.dataset.c }); // the Item Group the sub-category sits under
			frappe.new_doc("Item Group", { parent_item_group: el.dataset.c, is_group: 0 });
		} else if (act === "add-item") {
			frappe.new_doc("Item", { item_group: el.dataset.s, asset_category: el.dataset.c, is_fixed_asset: 1, is_stock_item: 0 });
		} else if (act === "add-asset") {
			frappe.new_doc("Asset", { item_code: n });
		} else if (act === "item-assets") {
			this.app._assetFilters = { search: n, category: el.dataset.c, sub_category: el.dataset.s, status: "" };
			this.app.go("assets");
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
