// Asset Workspace: a full-screen custom UI for the simplified Asset Management module (route /app/asset-workspace/...).
// Same look as the SOR Workspace (public/css/asset_workspace.css), rendered in a shadow root. Server: asset_management/api.py.
// Everything is ERPNext's standard Assets module: Asset Category > Item Group (sub-category) > Item > Asset ("Macbook Air M1 - 001").
// Assets are created on the standard Asset form; assign / return submit a standard Asset Movement (sets the Custodian).

frappe.pages["asset-workspace"].on_page_load = function (wrapper) {
	window.asset_app = new AssetApp(wrapper);
};
frappe.pages["asset-workspace"].on_page_show = function () {
	if (window.asset_app) window.asset_app.show();
};

const AM_VERSION = "1.0.0";
const AM_ROUTE = "asset-workspace";
const AM_API = "asset_management.asset_management.api.";
const amReduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ helpers

const amEsc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
const amFlt = (v) => parseFloat(v) || 0;
const amInr = (v, d = 0) =>
	(Number(v) < 0 ? "−" : "") + "₹" + Math.abs(Number(v || 0)).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const amDate = (d) => (d ? frappe.datetime.str_to_user(String(d).slice(0, 10)) : "");
const amStrip = (html) => {
	const d = document.createElement("div");
	d.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n");
	return d.textContent.trim();
};
/** "Research & Development - IL" -> "Research & Development" (drop the company abbreviation). */
const amDept = (d) => String(d || "").replace(/\s+-\s+[A-Z0-9]{1,6}$/, "");
const amInitials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

const AM_ICONS = {
	search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
	moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
	back: '<path d="M15 18l-6-6 6-6"/>',
	out: '<path d="M7 17 17 7M9 7h8v8"/>',
	x: '<path d="M6 6l12 12M18 6 6 18"/>',
	check: '<path d="m5 12 5 5L20 7"/>',
	ret: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
	edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
	trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
	logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
	grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
	gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
	laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
	cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/>',
	user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
	users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
	box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
	tree: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
};
const amIcon = (name) => `<svg class="i" viewBox="0 0 24 24">${AM_ICONS[name] || ""}</svg>`;

const AM_STATUS = {
	Available: "green",
	Assigned: "cyan",
	Draft: "red",
	"Under Repair": "orange",
	Disposed: "grey",
	Returned: "purple",
	Hardware: "lime",
	Subscription: "purple",
	Good: "green",
	"Needs Repair": "orange",
	"Lost / Retired": "red",
	"Warranty expired": "red",
	"Warranty ends": "orange",
	Renewal: "purple",
};
const AM_STATUSES = ["Available", "Assigned", "Draft", "Under Repair", "Disposed"];
const AM_COLOURS = ["#d5f65a", "#7dd3fc", "#f472b6", "#fb923c", "#a78bfa", "#2dd4bf", "#facc15", "#60a5fa"];
const amPill = (text, colour) =>
	text ? `<span class="pill ${colour || AM_STATUS[text] || "grey"}"><i></i>${amEsc(text)}</span>` : "";
/** "IT Hardware › Laptop" under an asset. */
const amPath = (r) => `<span class="sub">${amEsc([r.category, r.sub_category].filter(Boolean).join(" › "))}</span>`;
const amTypeIcon = (type) => amIcon(type === "Subscription" ? "cloud" : "laptop");

const AM_TABS = [
	["", "Dashboard"],
	["assign", "Assign & Return"],
	["employees", "Employees"],
	["assets", "Assets"],
	["reports", "Reports"],
];

// Additions to asset_workspace.css for this page only.
const AM_CSS = `
	.am-check { accent-color: #7c4dff; width: 16px; height: 16px; cursor: pointer; vertical-align: middle; margin: 0; }
	.t th.ck, .t td.ck { width: 30px; padding-right: 0; }
	.am-who { display: flex; align-items: center; gap: 10px; min-width: 0; }
	.am-av { width: 32px; height: 32px; border-radius: 50%; flex: none; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff;
		background: linear-gradient(135deg, #7c4dff, #29b6f6) center / cover; }
	.am-av.lg { width: 56px; height: 56px; font-size: 19px; }
	.am-tags { display: flex; flex-wrap: wrap; gap: 4px; }
	.am-sub-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 2px 4px; margin-top: 8px; border-top: 1px solid var(--line); }
	.am-sub-head:first-of-type { border-top: 0; margin-top: 0; }
	.am-sub-head b { font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 8px; }
	.am-sub-head b::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--acc, var(--lav)); }
	.am-sel { display: flex; flex-wrap: wrap; gap: 6px; }
	.am-count { color: var(--muted); font-size: 12.5px; font-weight: 400; }
	.am-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-bottom: 12px; }
	.am-cat .st-label { display: flex; align-items: center; gap: 8px; }
	.am-cat .st-label svg.i { color: var(--acc); }
	.am-board { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
	.am-board .card + .card { margin-top: 0; }
	.am-board .table-wrap { max-height: calc(100vh - 330px); overflow-y: auto; }
	.am-board thead th { position: sticky; top: 0; background: rgba(22, 18, 46, .96); z-index: 1; }
	:host(.light) .am-board thead th { background: #fff; }
	.am-days { font-size: 11.5px; }
	.am-days.late { color: var(--red); } .am-days.near { color: var(--orange); }
	.am-items { table-layout: fixed; width: 100%; }
	.am-items th:nth-child(1) { width: 32%; } .am-items th:nth-child(2) { width: 18%; } .am-items th:nth-child(3), .am-items th:nth-child(4), .am-items th:nth-child(5) { width: 10%; }
	.am-items td { overflow: hidden; text-overflow: ellipsis; }
	.am-reports { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
	.am-rep-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
	.am-rep-grid .card + .card { margin-top: 0; }
	.t th.sortable .arr { opacity: .55; margin-left: 4px; font-size: 10px; }
	.am-neg { color: var(--red); } .am-pos { color: var(--lime); }
	.am-hero { display: flex; align-items: center; gap: 16px; }
	@media (max-width: 1100px) { .am-board { grid-template-columns: minmax(0, 1fr); } .am-board .table-wrap { max-height: none; } }
`;

// ------------------------------------------------------------------ app

class AssetApp {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.host = document.createElement("div");
		this.host.className = "sor-host";
		wrapper.appendChild(this.host);
		this.root = this.host.attachShadow({ mode: "open" });
		this.root.innerHTML = `
			<link rel="stylesheet" href="/assets/asset_management/css/asset_workspace.css?v=${AM_VERSION}-${Date.now() >> 20}">
			<style>${AM_CSS}</style>
			<div class="stage">
				<div class="panel">
					<header class="top">
						<a class="brand" data-go="">
							<img class="logo-img" src="/assets/asset_management/images/miraggio.png" alt="Miraggio"><span class="brand-name">Asset Workspace</span>
						</a>
						<nav class="tabs"><span class="tab-ink"></span>${AM_TABS.map(([r, l]) => `<a class="tab" data-go="${r}" data-tab="${r}">${l}</a>`).join("")}</nav>
						<div class="top-actions">
							<button class="round" data-act="erp" title="Back to ERPNext">${amIcon("grid")}</button>
							<button class="round theme-btn" data-act="theme" title="Switch to light mode">${amIcon("sun")}</button>
							<button class="round settings-btn" data-go="catalogue" title="Catalogue: categories, sub-categories and items">${amIcon("gear")}</button>
							<div class="menu-wrap">
								<span class="avatar" data-act="user-menu"></span>
								<div class="menu user-menu"></div>
							</div>
						</div>
					</header>
					<main class="main"><div class="spin"></div></main>
				</div>
				<div class="toasts"></div>
			</div>`;
		this.main = this.$(".main");
		let theme = "dark";
		try {
			theme = localStorage.getItem("sor_theme") || "dark"; // same key as the SOR Workspace, so both follow one choice
		} catch (e) {
			/* storage blocked: default theme */
		}
		this.setTheme(theme);
		this.bind();
		this.bindDatePicker();
		window.addEventListener("resize", () => this.moveInk(true));
		new MutationObserver(() => {
			if (this._enter == null || !this.main.querySelector(":scope > :not(.spin)")) return;
			const dir = this._enter;
			this._enter = null;
			this.animate(this.main, dir);
		}).observe(this.main, { childList: true });
		frappe.router.on("change", () => this.toggleScroll());
		this.ready = this.loadBoot();
	}

	loadBoot() {
		return this.api("boot").then((b) => {
			this.boot = b;
			this.renderUser();
		});
	}

	$(sel, el) {
		return (el || this.root).querySelector(sel);
	}
	$$(sel, el) {
		return Array.from((el || this.root).querySelectorAll(sel));
	}

	toggleScroll() {
		document.documentElement.style.overflow = frappe.get_route()[0] === AM_ROUTE ? "hidden" : "";
	}

	bind() {
		this.root.addEventListener("click", (e) => {
			if (!e.target.closest("[data-act='user-menu']") && !e.target.closest(".user-menu")) this.$(".user-menu").classList.remove("open");
			const go = e.target.closest("[data-go]");
			if (go && !e.target.closest("[data-act], button.stop, input")) {
				e.preventDefault();
				this.go(...go.dataset.go.split("|"));
				return;
			}
			const ext = e.target.closest("[data-erp]");
			if (ext) {
				e.preventDefault();
				const [doctype, name] = ext.dataset.erp.split("|");
				this.openForm(doctype, name);
				return;
			}
			const act = e.target.closest("[data-act]");
			if (act) this.onAct(act.dataset.act, act, e);
		});
	}

	setTheme(theme) {
		const light = theme === "light";
		this.host.classList.toggle("light", light);
		const btn = this.$(".theme-btn");
		if (btn) {
			btn.innerHTML = amIcon(light ? "moon" : "sun");
			btn.title = light ? "Switch to dark mode" : "Switch to light mode";
		}
		try {
			localStorage.setItem("sor_theme", light ? "light" : "dark");
		} catch (e) {
			/* storage blocked: theme lasts for this visit */
		}
	}

	onAct(act, el, e) {
		if (act === "theme") return this.setTheme(this.host.classList.contains("light") ? "dark" : "light");
		if (act === "erp") return (window.location.href = "/app");
		if (act === "user-menu") return this.$(".user-menu").classList.toggle("open");
		if (act === "classic") return frappe.set_route("List", "Asset");
		if (act === "logout") return frappe.app.logout();
		if (this.view && this.view.onAct) this.view.onAct(act, el, e);
	}

	renderUser() {
		const b = this.boot;
		const av = this.$(".avatar");
		if (b.user_image) av.style.backgroundImage = `url("${encodeURI(b.user_image)}")`;
		else av.textContent = (b.first_name || "?").charAt(0).toUpperCase();
		this.$(".user-menu").innerHTML = `
			<div class="who"><b>${amEsc(b.full_name)}</b>${amEsc(b.user)}</div>
			<div class="sep"></div>
			<a data-act="erp">${amIcon("grid")} Back to ERPNext</a>
			<a data-act="classic">${amIcon("box")} Standard Asset list</a>
			<div class="sep"></div>
			<a data-act="logout">${amIcon("logout")} Log out</a>`;
	}

	markTab(sub) {
		const tab = { employee: "employees", asset: "assets" }[sub] ?? sub;
		this.$$(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
		this.$(".settings-btn").classList.toggle("on", sub === "catalogue");
		this.moveInk();
		return tab;
	}

	go(...parts) {
		this.markTab(parts[0] || "");
		frappe.set_route(AM_ROUTE, ...parts.filter((p) => p !== undefined && p !== null && p !== ""));
	}

	async show() {
		this.toggleScroll();
		this.$$(".overlay").forEach((o) => o.remove());
		try {
			await this.ready;
		} catch (err) {
			this.main.innerHTML = `<div class="empty">${amEsc(err.message || err)}</div>`;
			return;
		}
		const [, sub = "", name] = frappe.get_route();
		const order = ["", "assign", "employees", "assets", "reports", "catalogue"];
		const tab = this.markTab(sub);
		const dir = this._tab == null || this._tab === tab ? 0 : Math.sign(order.indexOf(tab) - order.indexOf(this._tab));
		this._tab = tab;
		if (this._shown && !amReduced() && !this.main.querySelector(":scope > .spin")) {
			this.main.classList.add("view-leave");
			await new Promise((r) => setTimeout(r, 130));
			this.main.classList.remove("view-leave");
		}
		this._shown = true;
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
		this.main.innerHTML = '<div class="spin"></div>';
		this.main.scrollTop = 0;
		this._enter = dir;
		const token = (this.token = Symbol());
		this.view = new View(this, name);
		try {
			await this.view.render(token);
		} catch (err) {
			if (this.token === token) this.main.innerHTML = `<div class="empty">${amEsc(err.message || err)}</div>`;
		}
	}

	moveInk(instant) {
		const ink = this.$(".tab-ink");
		const on = this.$(".tab.on");
		this.$(".tabs").classList.add("has-ink");
		if (!on) {
			ink.style.opacity = "0";
			return;
		}
		const first = !ink.style.width;
		ink.classList.toggle("instant", !!(instant || first));
		Object.assign(ink.style, { opacity: "1", left: on.offsetLeft + "px", top: on.offsetTop + "px", width: on.offsetWidth + "px", height: on.offsetHeight + "px" });
		if (first) setTimeout(() => this.moveInk(true), 400);
	}

	/** Entrance for freshly rendered content: blocks rise in one after another (asset_workspace.css .rise). */
	animate(container, dir = 0) {
		if (!container || amReduced()) return;
		const GROUP = /^(grid2|grid3|kpis|st-cards|am-cards|am-board)$/;
		const items = [];
		const walk = (el, depth) => {
			for (const c of el.children) {
				if (c.classList.contains("spin")) continue;
				if (depth < 2 && [...c.classList].some((k) => GROUP.test(k))) walk(c, depth + 1);
				else items.push(c);
			}
		};
		walk(container, 0);
		container.style.setProperty("--dir", dir);
		items.slice(0, 30).forEach((el, i) => {
			el.style.setProperty("--i", Math.min(i, 14));
			el.classList.add("rise");
		});
		container.classList.add("anim-bars");
		clearTimeout(container._animT);
		container._animT = setTimeout(() => {
			items.forEach((el) => el.classList.remove("rise"));
			container.classList.remove("anim-bars");
		}, 1800);
	}

	dismiss(ov) {
		if (!ov.isConnected || ov.classList.contains("closing")) return;
		if (amReduced()) return ov.remove();
		ov.classList.add("closing");
		setTimeout(() => ov.remove(), 180);
	}

	stale(token) {
		return this.token !== token;
	}

	/** Re-render the current view in place (after an assign, return or edit). */
	refresh() {
		if (this.view) this.view.render((this.token = Symbol())).catch((err) => this.toast(err.message, "error"));
	}

	// -------------------------------------------------------------- server

	async api(method, args = {}) {
		const res = await fetch("/api/method/" + (method.includes(".") ? method : AM_API + method), {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json", "X-Frappe-CSRF-Token": frappe.csrf_token },
			body: JSON.stringify(args),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data.exc || data.exception) throw new Error(this.serverError(data, res.status));
		return data.message;
	}

	serverError(data, status) {
		const msgs = [];
		if (data._server_messages) {
			try {
				JSON.parse(data._server_messages).forEach((m) => {
					try {
						msgs.push(JSON.parse(m).message || m);
					} catch (e) {
						msgs.push(m);
					}
				});
			} catch (e) {
				/* ignore */
			}
		}
		if (!msgs.length && data.exception) msgs.push(String(data.exception).replace(/^[\w.]+Error:\s*/, ""));
		if (!msgs.length) msgs.push(status === 403 ? "You do not have permission for this." : "Something went wrong. Please try again.");
		return amStrip(msgs.join("\n"));
	}

	// -------------------------------------------------------------- feedback

	toast(message, kind = "ok") {
		const t = document.createElement("div");
		t.className = "toast " + (kind === "ok" ? "" : kind);
		t.textContent = message;
		this.$(".toasts").appendChild(t);
		setTimeout(() => {
			t.classList.add("out");
			setTimeout(() => t.remove(), 220);
		}, kind === "error" ? 9000 : 4500);
	}

	confirm(title, message, label = "Confirm") {
		return new Promise((resolve) => {
			this.modal({
				title,
				body: `<div class="note" style="white-space:pre-line">${amEsc(message)}</div>`,
				primary: label,
				onSubmit: () => {
					resolve(true);
					return true;
				},
				onClose: () => resolve(false),
			});
		});
	}

	/**
	 * modal({title, fields, body, primary, wide, onSubmit(values, m) -> truthy/Promise, onOpen(m), onClose})
	 * fields: {name, label, type: text|number|date|select|textarea|link|check|html, options, reqd, default, help, doctype, filters}
	 */
	modal(opts) {
		const ov = document.createElement("div");
		ov.className = "overlay";
		ov.innerHTML = `
			<div class="modal ${opts.wide ? "wide" : ""}" role="dialog">
				<div class="modal-head"><h3>${amEsc(opts.title)}</h3><button class="round sm ghost" data-x>${amIcon("x")}</button></div>
				<div class="modal-body">${opts.body || ""}${(opts.fields || []).map((f) => this.fieldHtml(f)).join("")}</div>
				<div class="modal-foot">
					<button class="btn" data-x>${opts.primary === false ? "Close" : "Cancel"}</button>
					${opts.primary === false ? "" : `<button class="btn white" data-ok>${amEsc(opts.primary || "Save")}</button>`}
				</div>
			</div>`;
		this.$(".stage").appendChild(ov);
		const m = {
			el: ov,
			close: () => {
				this.dismiss(ov);
				if (opts.onClose && !m.done) opts.onClose();
			},
			values: () => this.readFields(ov, opts.fields || []),
			set: (name, value) => this.setField(ov, name, value),
		};
		this.wireFields(ov, opts.fields || []);
		ov.addEventListener("click", (e) => {
			if (e.target === ov || e.target.closest("[data-x]")) m.close();
		});
		const ok = ov.querySelector("[data-ok]");
		if (ok) {
			ok.addEventListener("click", async () => {
				const values = m.values();
				const missing = (opts.fields || []).filter((f) => f.reqd && (values[f.name] === "" || values[f.name] == null));
				if (missing.length) {
					this.toast("Please fill: " + missing.map((f) => f.label).join(", "), "error");
					return;
				}
				ok.disabled = true;
				const label = ok.textContent;
				ok.textContent = "Working…";
				try {
					const res = await opts.onSubmit(values, m);
					if (res !== false) {
						m.done = true;
						this.dismiss(ov);
					}
				} catch (err) {
					this.toast(err.message || String(err), "error");
				} finally {
					ok.disabled = false;
					ok.textContent = label;
				}
			});
		}
		if (opts.onOpen) opts.onOpen(m);
		const first = ov.querySelector(".modal-body .inp:not([type=date])");
		if (first) setTimeout(() => first.focus(), 30);
		return m;
	}

	fieldHtml(f) {
		const id = "f_" + f.name;
		const req = f.reqd ? " <b>*</b>" : "";
		const help = f.help ? `<div class="help">${amEsc(f.help)}</div>` : "";
		const val = f.default == null ? "" : f.default;
		let control;
		switch (f.type) {
			case "html":
				return `<div data-field="${f.name}">${f.html || ""}</div>`;
			case "select":
				control = `<select class="inp" data-name="${f.name}" id="${id}">${(f.options || [])
					.map((o) => {
						const [v, l] = typeof o === "object" ? [o.value, o.label] : [o, o];
						return `<option value="${amEsc(v)}" ${String(v) === String(val) ? "selected" : ""}>${amEsc(l === "" ? "—" : l)}</option>`;
					})
					.join("")}</select>`;
				break;
			case "textarea":
				control = `<textarea class="inp" data-name="${f.name}" id="${id}" style="min-height:70px;font-family:inherit;font-size:13px">${amEsc(val)}</textarea>`;
				break;
			case "link":
				control = `<div class="ac-wrap"><input class="inp" autocomplete="off" data-name="${f.name}" data-link="${amEsc(f.doctype)}" id="${id}" value="${amEsc(val)}" placeholder="${amEsc(f.placeholder || "Search " + f.doctype)}"></div>`;
				break;
			default:
				control = `<input class="inp" type="${f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}" ${f.type === "number" ? 'step="any" min="0"' : ""} data-name="${f.name}" id="${id}" value="${amEsc(val)}" placeholder="${amEsc(f.placeholder || "")}">`;
		}
		return `<div class="fld" data-wrap="${f.name}"${f.hidden ? ' style="display:none"' : ""}><label for="${id}">${amEsc(f.label)}${req}</label>${control}${help}</div>`;
	}

	wireFields(root, fields) {
		this.$$("[data-link]", root).forEach((input) => this.linkControl(input, () => {
			const f = fields.find((x) => x.name === input.dataset.name);
			return f && f.filters ? (typeof f.filters === "function" ? f.filters() : f.filters) : {};
		}));
		fields.forEach((f) => {
			if (!f.onchange) return;
			const el = root.querySelector(`[data-name="${f.name}"]`);
			if (el) el.addEventListener("change", () => f.onchange(el.value, root));
		});
	}

	readFields(root, fields) {
		const out = {};
		fields.forEach((f) => {
			const el = root.querySelector(`[data-name="${f.name}"]`);
			if (!el) return;
			if (f.type === "number") out[f.name] = el.value === "" ? "" : amFlt(el.value);
			else out[f.name] = el.value.trim();
		});
		return out;
	}

	setField(root, name, value) {
		const el = root.querySelector(`[data-name="${name}"]`);
		if (el) el.value = value == null ? "" : value;
	}

	/** Autocomplete for a Link input (server whitelist in api.link_search). */
	linkControl(input, getFilters) {
		let box = null;
		let timer = null;
		const stage = this.$(".stage");
		const place = () => {
			if (!box) return;
			const r = input.getBoundingClientRect();
			const st = stage.getBoundingClientRect();
			box.style.width = Math.max(r.width, 280) + "px";
			box.style.left = Math.min(r.left - st.left, st.width - Math.max(r.width, 280) - 8) + "px";
			const fitsBelow = r.bottom + box.offsetHeight + 8 <= st.bottom;
			box.style.top = (fitsBelow ? r.bottom - st.top + 4 : r.top - st.top - box.offsetHeight - 4) + "px";
		};
		const close = () => {
			if (box) box.remove();
			box = null;
			this.root.removeEventListener("scroll", place, true);
		};
		const pick = (v) => {
			input.value = v;
			close();
			input.dispatchEvent(new Event("change", { bubbles: true }));
		};
		const open = async () => {
			const items = await this.api("link_search", { doctype: input.dataset.link, txt: input.value, filters: getFilters ? getFilters() : {} }).catch(() => []);
			if (input.getRootNode().activeElement !== input) return;
			close();
			box = document.createElement("div");
			box.className = "ac ac-float";
			box.innerHTML = items.length
				? items.map((it, i) => `<div data-v="${amEsc(it.value)}" class="${i ? "" : "on"}">${amEsc(it.value)}${it.label && it.label !== it.value ? `<small>${amEsc(it.label)}</small>` : ""}</div>`).join("")
				: `<div class="faint">No match</div>`;
			box.addEventListener("mousedown", (e) => {
				const d = e.target.closest("[data-v]");
				if (d) {
					e.preventDefault();
					pick(d.dataset.v);
				}
			});
			stage.appendChild(box);
			place();
			this.root.addEventListener("scroll", place, true);
		};
		input.addEventListener("focus", open);
		input.addEventListener("input", () => {
			clearTimeout(timer);
			timer = setTimeout(open, 180);
		});
		input.addEventListener("blur", () => setTimeout(close, 150));
		input.addEventListener("keydown", (e) => {
			if (!box) return;
			const opts = Array.from(box.querySelectorAll("[data-v]"));
			let i = opts.findIndex((o) => o.classList.contains("on"));
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				if (opts[i]) opts[i].classList.remove("on");
				i = e.key === "ArrowDown" ? Math.min(i + 1, opts.length - 1) : Math.max(i - 1, 0);
				if (opts[i]) opts[i].classList.add("on");
			} else if (e.key === "Enter" && opts[i]) {
				e.preventDefault();
				pick(opts[i].dataset.v);
			} else if (e.key === "Escape") close();
		});
	}

	// -------------------------------------------------------------- date picker (same as the SOR Workspace)

	bindDatePicker() {
		this.root.addEventListener("click", (e) => {
			const inp = e.target.closest && e.target.closest("input.inp[type=date]");
			if (inp) {
				e.preventDefault();
				if (this._dp && this._dp.inp === inp) return this.closeDatePicker();
				return this.openDatePicker(inp);
			}
			if (this._dp && !this._dp.el.contains(e.target)) this.closeDatePicker();
		}, true);
		this.root.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && this._dp) this.closeDatePicker();
		}, true);
		this.root.addEventListener("scroll", () => this.closeDatePicker(), true);
		window.addEventListener("resize", () => this.closeDatePicker());
	}

	openDatePicker(inp) {
		this.closeDatePicker();
		const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		const today = iso(new Date());
		const view = inp.value ? new Date(inp.value + "T00:00:00") : new Date();
		view.setDate(1);
		const el = document.createElement("div");
		el.className = "dp";
		const stage = this.$(".stage");
		stage.appendChild(el);
		this._dp = { el, inp };
		const pick = (value) => {
			inp.value = value;
			inp.dispatchEvent(new Event("input", { bubbles: true }));
			inp.dispatchEvent(new Event("change", { bubbles: true }));
			this.closeDatePicker();
		};
		const render = () => {
			const y = view.getFullYear(), m = view.getMonth();
			const start = new Date(y, m, 1 - new Date(y, m, 1).getDay());
			const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
			el.innerHTML = `
				<div class="dp-head">
					<button class="dp-nav" data-dp="prev" title="Previous month">‹</button>
					<span class="dp-title">${view.toLocaleString("en-IN", { month: "long" })} ${y}</span>
					<button class="dp-nav" data-dp="next" title="Next month">›</button>
				</div>
				<div class="dp-grid">${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => `<span class="dp-wd">${d}</span>`).join("")}
					${days.map((d) => {
						const v = iso(d);
						const cls = ["dp-day", d.getMonth() !== m && "out", v === today && "today", v === inp.value && "sel"].filter(Boolean).join(" ");
						return `<button class="${cls}" data-dp="day" data-d="${v}">${d.getDate()}</button>`;
					}).join("")}
				</div>
				<div class="dp-foot"><button class="dp-link" data-dp="clear">Clear</button><button class="dp-link" data-dp="today">Today</button></div>`;
		};
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			const t = e.target.closest("[data-dp]");
			if (!t) return;
			const a = t.dataset.dp;
			if (a === "prev" || a === "next") {
				view.setMonth(view.getMonth() + (a === "next" ? 1 : -1));
				return render();
			}
			pick(a === "clear" ? "" : a === "today" ? today : t.dataset.d);
		});
		render();
		const r = inp.getBoundingClientRect(), s = stage.getBoundingClientRect();
		const width = el.offsetWidth, height = el.offsetHeight;
		const below = r.bottom + 6 + height <= s.bottom;
		el.style.left = Math.max(8, Math.min(r.left - s.left, s.width - width - 8)) + "px";
		el.style.top = (below ? r.bottom - s.top + 6 : r.top - s.top - height - 6) + "px";
	}

	closeDatePicker() {
		if (!this._dp) return;
		this._dp.el.remove();
		this._dp = null;
	}

	// -------------------------------------------------------------- shared dialogs

	/** Open a standard ERPNext form (Asset, Item, Asset Category, …): records are only ever made there. */
	openForm(doctype, name) {
		frappe.set_route("Form", doctype, name);
	}
	/** The full form, not Quick Entry: a quick-entry dialog would open behind this full-screen page. */
	newDoc(doctype, values = {}) {
		frappe.model.with_doctype(doctype, () => {
			const doc = frappe.model.get_new_doc(doctype);
			Object.assign(doc, values);
			frappe.set_route("Form", doctype, doc.name);
		});
	}

	/** Assign one or more assets to an employee: a standard Asset Movement (Issue). Pass `employee` to fix the employee. */
	assignDialog({ assets = [], employee = "", onDone } = {}) {
		const fields = [];
		if (!assets.length) {
			fields.push({ name: "asset", label: "Asset", type: "link", doctype: "Asset", reqd: 1, filters: { available: 1 }, placeholder: "Search available assets" });
		}
		fields.push(
			{ name: "employee", label: "Employee", type: "link", doctype: "Employee", reqd: 1, default: employee, placeholder: "Search by name or ID" },
			{ name: "assigned_on", label: "Assigned on", type: "date", reqd: 1, default: this.boot.today },
		);
		const list = assets.length
			? `<div class="fld"><label>${assets.length === 1 ? "Asset" : assets.length + " assets"}</label><div class="am-sel">${assets.map((a) => amPill(a, "cyan")).join("")}</div></div>`
			: "";
		this.modal({
			title: assets.length > 1 ? `Assign ${assets.length} assets` : "Assign asset",
			body: list + `<div class="note">Creates and submits a standard Asset Movement (Issue), which sets the asset's Custodian.</div>`,
			fields,
			primary: "Assign",
			onSubmit: async (v) => {
				const names = assets.length ? assets : [v.asset];
				const r = await this.api("assign", { assets: names, employee: v.employee, assigned_on: v.assigned_on });
				this.toast(`${names.length === 1 ? names[0] : names.length + " assets"} assigned to ${r.employee_name || v.employee} (${r.movements.join(", ")})`);
				(onDone || (() => this.refresh()))();
			},
		});
	}

	/** Take assets back: a standard Asset Movement (Receipt) to the asset's location, which clears the Custodian. */
	returnDialog({ assets, holder, onDone }) {
		this.modal({
			title: assets.length > 1 ? `Return ${assets.length} assets` : "Return asset",
			body: `<div class="fld"><label>${assets.length === 1 ? "Asset" : assets.length + " assets"}${holder ? " from " + amEsc(holder) : ""}</label><div class="am-sel">${assets.map((a) => amPill(a, "cyan")).join("")}</div></div>
				<div class="note">Creates and submits a standard Asset Movement (Receipt) back to the asset's location.</div>`,
			fields: [{ name: "returned_on", label: "Returned on", type: "date", reqd: 1, default: this.boot.today }],
			primary: "Return",
			onSubmit: async (v) => {
				const r = await this.api("unassign", { assets, returned_on: v.returned_on });
				this.toast(`${assets.length === 1 ? assets[0] : assets.length + " assets"} returned (${r.movements.join(", ")})`);
				(onDone || (() => this.refresh()))();
			},
		});
	}
}

// ------------------------------------------------------------------ views: shared bits

class AmView {
	constructor(app, name) {
		this.app = app;
		this.name = name;
	}
	get main() {
		return this.app.main;
	}
	get boot() {
		return this.app.boot;
	}
	api(m, a) {
		return this.app.api(m, a);
	}
	$(s) {
		return this.app.$(s, this.main);
	}
	$$(s) {
		return this.app.$$(s, this.main);
	}
	head(title, sub = "", actions = "", back = null) {
		return `<div class="view-head">
			<div>${back ? `<a class="back" data-go="${back[0]}">${amIcon("back")} ${amEsc(back[1])}</a>` : ""}
				<h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>
			<div class="actions">${actions}</div>
		</div>`;
	}
	selectHtml(name, options, value, minWidth = 170) {
		return `<select class="inp sm" data-f="${name}" style="width:auto;min-width:${minWidth}px">${options
			.map((o) => `<option value="${amEsc(o.value)}" ${String(o.value) === String(value || "") ? "selected" : ""}>${amEsc(o.label)}</option>`)
			.join("")}</select>`;
	}
	categoryOptions() {
		return [{ value: "", label: "All categories" }, ...this.boot.categories.map((c) => ({ value: c.name, label: c.name }))];
	}
	subCategoryOptions(category) {
		const subs = this.boot.sub_categories.filter((s) => !category || s.category === category);
		return [{ value: "", label: "All sub-categories" }, ...subs.map((s) => ({ value: s.name, label: s.name }))];
	}
	/** Search box + category + sub-category filters, wired to this.filters and this.reload(). */
	filterBar(placeholder, extra = "") {
		return `<div class="filters">
			<label class="search">${amIcon("search")}<input data-f="search" placeholder="${amEsc(placeholder)}" value="${amEsc(this.filters.search || "")}"></label>
			${this.selectHtml("category", this.categoryOptions(), this.filters.category)}
			${this.selectHtml("sub_category", this.subCategoryOptions(this.filters.category), this.filters.sub_category)}
			${extra}
		</div>`;
	}
	bindFilterBar() {
		const s = this.$("[data-f=search]");
		let t;
		s.addEventListener("input", () => {
			clearTimeout(t);
			t = setTimeout(() => {
				this.filters.search = s.value.trim();
				this.reload(true);
			}, 300);
		});
		this.$("[data-f=category]").addEventListener("change", (e) => {
			this.filters.category = e.target.value;
			this.filters.sub_category = "";
			this.reload();
		});
		this.$("[data-f=sub_category]").addEventListener("change", (e) => {
			this.filters.sub_category = e.target.value;
			this.reload();
		});
	}
	async reload(keepFocus) {
		const pos = keepFocus ? this.$("[data-f=search]").selectionStart : null;
		await this.render((this.app.token = Symbol()));
		if (keepFocus) {
			const s = this.$("[data-f=search]");
			s.focus();
			s.setSelectionRange(pos, pos);
		}
	}
	who(name, sub, image) {
		return `<div class="am-who"><span class="am-av" ${image ? `style="background-image:url('${encodeURI(image)}')"` : ""}>${image ? "" : amEsc(amInitials(name))}</span>
			<div style="min-width:0"><div class="strong">${amEsc(name)}</div>${sub ? `<span class="sub">${amEsc(sub)}</span>` : ""}</div></div>`;
	}
	expiryHtml(r) {
		if (!r.expiry_date) return `<span class="faint">—</span>`;
		const days = Math.round((new Date(r.expiry_date + "T00:00:00") - new Date(this.boot.today + "T00:00:00")) / 864e5);
		const cls = days < 0 ? "late" : days <= 45 ? "near" : "";
		const note = days < 0 ? `${-days}d overdue` : days <= 45 ? `in ${days}d` : "";
		return `${amDate(r.expiry_date)}${note ? `<span class="sub am-days ${cls}">${note}</span>` : ""}`;
	}
}

// ------------------------------------------------------------------ dashboard

class AmDashboardView extends AmView {
	async render(token) {
		const d = await this.api("dashboard");
		if (this.app.stale(token)) return;
		const s = d.by_status;
		const can = this.boot.can_assign;
		this.main.innerHTML = `
			<section class="view-head hello">
				<div>
					<h1>Welcome back, <span>${amEsc(d.first_name)}</span></h1>
					<div class="sub">${d.total} assets · ${d.holders} of ${d.employees} employees hold assets</div>
				</div>
				<div class="actions">
					${can ? `<button class="btn white" data-go="assign">${amIcon("swap")} Assign & return</button>` : ""}
					${this.boot.can_write ? `<button class="btn" data-act="add-assets">${amIcon("plus")} New asset</button>` : ""}
				</div>
			</section>
			<div class="kpis">
				<div class="kpi"><div class="k">Total assets</div><div class="v">${d.total}</div></div>
				<div class="kpi"><div class="k">Assigned</div><div class="v">${s.Assigned}</div></div>
				<div class="kpi"><div class="k">Available</div><div class="v lime">${s.Available}</div></div>
				<div class="kpi clickable" data-act="drafts" style="cursor:pointer"><div class="k">Draft (not submitted)</div><div class="v ${s.Draft ? "red" : ""}">${s.Draft}</div></div>
				<div class="kpi"><div class="k">Subscriptions / month</div><div class="v lav">${amInr(d.subscription_monthly)}</div></div>
				<div class="kpi"><div class="k">Hardware value</div><div class="v">${amInr(d.hardware_value)}</div></div>
			</div>
			${d.categories.length ? `<div class="am-cards">${d.categories.map((c, i) => `
				<div class="st-card am-cat t${(i % 6) + 1} clickable" data-act="cat" data-c="${amEsc(c.name)}" style="cursor:pointer">
					<div class="st-label">${amTypeIcon(c.type)} ${amEsc(c.name)}</div>
					<div class="st-total">${c.total}<small>assets</small></div>
					<div class="st-hint">${c.assigned} assigned · ${c.available} available · ${amEsc(c.type)}</div>
					<div class="st-rows">${c.subs.map((sc, j) => `<div class="st-row" style="--mp:${AM_COLOURS[(i + j) % AM_COLOURS.length]}">
						<span class="st-mp"><i></i>${amEsc(sc.name)}</span>
						<b>${sc.assigned}<small>of ${sc.total} assigned</small></b>
						<span class="st-bar"><i style="width:${sc.total ? (sc.assigned / sc.total) * 100 : 0}%"></i></span>
					</div>`).join("")}</div>
				</div>`).join("")}</div>`
			: `<div class="card"><div class="empty">No assets yet. Set up categories from the ${amIcon("gear")} catalogue, then add assets.</div></div>`}
			<section class="grid2">
				<div class="card">
					<div class="card-head"><span class="card-title">${amIcon("clock")} Warranties & renewals <span class="am-count">· overdue or due in 45 days</span></span></div>
					${d.expiring.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Holder</th><th>Date</th></tr></thead><tbody>
						${d.expiring.map((a) => `<tr class="click" data-go="asset|${amEsc(a.name)}">
							<td class="strong">${amEsc(a.name)}${amPath(a)}</td>
							<td>${a.employee_name ? amEsc(a.employee_name) : amPill(a.status)}</td>
							<td>${this.expiryHtml(a)}</td></tr>`).join("")}
					</tbody></table></div>` : `<div class="empty">No warranty or renewal is overdue or due in the next 45 days.</div>`}
				</div>
				<div class="card">
					<div class="card-head"><span class="card-title">${amIcon("swap")} Recent activity</span><a class="link small" data-go="employees">Employee mapping ›</a></div>
					${d.recent.length ? `<div class="actions-list">${d.recent.map((r) => `<a class="act-item" data-go="asset|${amEsc(r.asset)}">
						<span class="tone ${r.status === "Assigned" ? "cyan" : "purple"}"></span>
						<span class="act-text"><b>${amEsc(r.asset)} ${r.status === "Assigned" ? "issued to" : "returned by"} ${amEsc(r.employee_name || r.employee)}</b>
							<small>${amEsc(r.category || "")} · ${amDate(r.date)} · ${amEsc(r.movement)}</small></span>
						<span class="chev">›</span></a>`).join("")}</div>` : `<div class="empty">No assignments yet.</div>`}
				</div>
			</section>`;
	}
	onAct(act, el) {
		if (act === "cat") {
			this.app._assetFilters = { search: "", category: el.dataset.c, sub_category: "", status: "" };
			this.app.go("assets");
		} else if (act === "drafts") {
			this.app._assetFilters = { search: "", category: "", sub_category: "", status: "Draft" };
			this.app.go("assets");
		} else if (act === "add-assets") this.app.newDoc("Asset");
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
		const d = (this.data = await this.api("assign_board", { filters: this.filters }));
		if (this.app.stale(token)) return;
		this.app._assignFilters = this.filters;
		// keep only selections that are still on the board
		const still = (key) => new Set([...this.picked[key]].filter((n) => d[key].some((r) => r.name === n)));
		this.picked = { available: still("available"), assigned: still("assigned") };
		const can = this.boot.can_assign;
		this.main.innerHTML = `
			${this.head("Assign & <span>Return</span>", "Tick assets on the left and assign them to an employee; tick assets on the right to take them back. Each one is a standard Asset Movement.")}
			${d.drafts ? `<div class="banner orange">${d.drafts} asset${d.drafts === 1 ? " is" : "s are"} still Draft. Submit ${d.drafts === 1 ? "it" : "them"} on the Asset form to assign. <a class="link" data-act="drafts">Show drafts ›</a></div>` : ""}
			${this.filterBar("Search asset, serial no or employee")}
			<div class="am-board">
				<div class="card">
					<div class="card-head">
						<span class="card-title">${amIcon("box")} Available <span class="am-count">${d.available.length}</span></span>
						${can ? `<button class="btn sm white" data-act="assign-picked" disabled>${amIcon("user")} Assign selected</button>` : ""}
					</div>
					${d.available.length ? `<div class="table-wrap"><table class="t"><thead><tr>
						${can ? `<th class="ck"><input type="checkbox" class="am-check" data-all="available" title="Select all"></th>` : ""}<th>Asset</th><th>Type</th><th class="num"></th></tr></thead><tbody>
						${d.available.map((r) => `<tr>
							${can ? `<td class="ck"><input type="checkbox" class="am-check" data-pick="available" value="${amEsc(r.name)}" ${this.picked.available.has(r.name) ? "checked" : ""}></td>` : ""}
							<td class="strong"><a data-go="asset|${amEsc(r.name)}">${amEsc(r.name)}</a>${amPath(r)}</td>
							<td>${amPill(r.category_type)}${r.serial_no ? `<span class="sub">${amEsc(r.serial_no)}</span>` : ""}</td>
							<td class="num">${can ? `<button class="btn sm lime" data-act="assign-one" data-n="${amEsc(r.name)}">Assign</button>` : ""}</td>
						</tr>`).join("")}
					</tbody></table></div>` : `<div class="empty">Nothing available${this.filters.search || this.filters.category ? " for these filters" : ""}.</div>`}
				</div>
				<div class="card">
					<div class="card-head">
						<span class="card-title">${amIcon("users")} With employees <span class="am-count">${d.assigned.length}</span></span>
						${can ? `<button class="btn sm white" data-act="return-picked" disabled>${amIcon("ret")} Return selected</button>` : ""}
					</div>
					${d.assigned.length ? `<div class="table-wrap"><table class="t"><thead><tr>
						${can ? `<th class="ck"><input type="checkbox" class="am-check" data-all="assigned" title="Select all"></th>` : ""}<th>Asset</th><th>Employee</th><th>Since</th><th class="num"></th></tr></thead><tbody>
						${d.assigned.map((r) => `<tr>
							${can ? `<td class="ck"><input type="checkbox" class="am-check" data-pick="assigned" value="${amEsc(r.name)}" ${this.picked.assigned.has(r.name) ? "checked" : ""}></td>` : ""}
							<td class="strong"><a data-go="asset|${amEsc(r.name)}">${amEsc(r.name)}</a>${amPath(r)}</td>
							<td><a data-go="employee|${amEsc(r.assigned_to)}">${amEsc(r.employee_name || r.assigned_to)}</a><span class="sub">${amEsc(amDept(r.department) || r.assigned_to)}</span></td>
							<td class="nowrap">${amDate(r.assigned_on)}</td>
							<td class="num">${can ? `<button class="btn sm" data-act="return-one" data-n="${amEsc(r.name)}">${amIcon("ret")} Return</button>` : ""}</td>
						</tr>`).join("")}
					</tbody></table></div>` : `<div class="empty">No assets are with employees${this.filters.search || this.filters.category ? " for these filters" : ""}.</div>`}
				</div>
			</div>`;
		this.bindFilterBar();
		this.$(".am-board").addEventListener("change", (e) => this.onPick(e));
		this.paintPicked();
	}
	onPick(e) {
		const box = e.target;
		if (box.dataset.all) {
			const key = box.dataset.all;
			this.$$(`[data-pick=${key}]`).forEach((b) => {
				b.checked = box.checked;
				this.picked[key][box.checked ? "add" : "delete"](b.value);
			});
		} else if (box.dataset.pick) {
			this.picked[box.dataset.pick][box.checked ? "add" : "delete"](box.value);
		} else return;
		this.paintPicked();
	}
	paintPicked() {
		[["available", "assign-picked", "Assign"], ["assigned", "return-picked", "Return"]].forEach(([key, act, verb]) => {
			const btn = this.$(`[data-act=${act}]`);
			const n = this.picked[key].size;
			if (btn) {
				btn.disabled = !n;
				btn.innerHTML = `${amIcon(key === "available" ? "user" : "ret")} ${verb} ${n ? `selected (${n})` : "selected"}`;
			}
			const all = this.$(`[data-all=${key}]`);
			const boxes = this.$$(`[data-pick=${key}]`);
			if (all) {
				all.checked = boxes.length > 0 && boxes.every((b) => b.checked);
				all.indeterminate = !all.checked && boxes.some((b) => b.checked);
			}
		});
	}
	onAct(act, el) {
		const done = () => {
			this.picked = { available: new Set(), assigned: new Set() };
			this.app.refresh();
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
		const d = await this.api("employees", { search: this.filters.search, department: this.filters.department });
		if (this.app.stale(token)) return;
		this.app._empFilters = this.filters;
		const all = d.rows;
		const withAssets = all.filter((r) => r.assets.length);
		const rows = this.filters.holding === "yes" ? withAssets : this.filters.holding === "no" ? all.filter((r) => !r.assets.length) : all;
		const can = this.boot.can_assign;
		this.main.innerHTML = `
			${this.head("Employee <span>Mapping</span>", "Every active employee and the assets they hold. Open an employee to assign or take back assets.")}
			<div class="filters">
				<label class="search">${amIcon("search")}<input data-f="search" placeholder="Search name, ID or designation" value="${amEsc(this.filters.search)}"></label>
				${this.selectHtml("department", [{ value: "", label: "All departments" }, ...d.departments.map((x) => ({ value: x, label: x }))], this.filters.department, 190)}
			</div>
			<div class="chips" style="margin-bottom:12px">
				<button class="chip ${this.filters.holding ? "" : "on"}" data-act="holding" data-h="">All<b>${all.length}</b></button>
				<button class="chip ${this.filters.holding === "yes" ? "on" : ""}" data-act="holding" data-h="yes">Holding assets<b>${withAssets.length}</b></button>
				<button class="chip ${this.filters.holding === "no" ? "on" : ""}" data-act="holding" data-h="no">No assets<b>${all.length - withAssets.length}</b></button>
			</div>
			<div class="card">
				${rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Employee</th><th>Department</th><th class="num">Hardware</th><th class="num">Subscriptions</th><th>Assets</th><th></th></tr></thead><tbody>
					${rows.map((r) => `<tr class="click" data-go="employee|${amEsc(r.name)}">
						<td>${this.who(r.employee_name, `${r.name}${r.designation ? " · " + r.designation : ""}`, r.image)}</td>
						<td>${amEsc(amDept(r.department) || "—")}</td>
						<td class="num strong">${r.hardware || '<span class="faint">0</span>'}</td>
						<td class="num strong">${r.subscriptions || '<span class="faint">0</span>'}</td>
						<td><div class="am-tags">${r.assets.slice(0, 3).map((a) => amPill(a, "cyan")).join("")}${r.assets.length > 3 ? amPill("+" + (r.assets.length - 3), "grey") : ""}${r.assets.length ? "" : '<span class="faint">—</span>'}</div></td>
						<td class="num">${can ? `<button class="btn sm" data-act="assign" data-e="${amEsc(r.name)}">${amIcon("plus")} Assign</button>` : ""}</td>
					</tr>`).join("")}
				</tbody></table></div>` : `<div class="empty">No employees match. Employees come from ERPNext's Employee list.</div>`}
			</div>`;
		const s = this.$("[data-f=search]");
		let t;
		s.addEventListener("input", () => {
			clearTimeout(t);
			t = setTimeout(() => {
				this.filters.search = s.value.trim();
				this.reload(true);
			}, 300);
		});
		this.$("[data-f=department]").addEventListener("change", (e) => {
			this.filters.department = e.target.value;
			this.reload();
		});
	}
	onAct(act, el) {
		if (act === "holding") {
			this.filters.holding = el.dataset.h;
			this.reload();
		} else if (act === "assign") this.app.assignDialog({ employee: el.dataset.e });
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
		this.main.innerHTML = `
			<div class="view-head">
				<div><a class="back" data-go="employees">${amIcon("back")} Employees</a>
					<div class="am-hero" style="margin-top:8px">
						<span class="am-av lg" ${e.image ? `style="background-image:url('${encodeURI(e.image)}')"` : ""}>${e.image ? "" : amEsc(amInitials(e.employee_name))}</span>
						<div><h1>${amEsc(e.employee_name)}</h1>
						<div class="sub"><span>${amEsc(e.name)}</span>${e.designation ? `<span>${amEsc(e.designation)}</span>` : ""}${e.department ? `<span>${amEsc(amDept(e.department))}</span>` : ""}${e.company_email ? `<span>${amEsc(e.company_email)}</span>` : ""}</div></div>
					</div>
				</div>
				<div class="actions">
					${can ? `<button class="btn white" data-act="assign">${amIcon("plus")} Assign asset</button>` : ""}
					<button class="btn" data-erp="Employee|${amEsc(e.name)}">${amIcon("out")} Employee record</button>
				</div>
			</div>
			<div class="kpis">
				<div class="kpi"><div class="k">Assets held</div><div class="v">${cur.length}</div></div>
				<div class="kpi"><div class="k">Hardware</div><div class="v lime">${hw}</div></div>
				<div class="kpi"><div class="k">Subscriptions</div><div class="v lav">${cur.length - hw}</div></div>
				<div class="kpi"><div class="k">Assignments to date</div><div class="v">${d.history.length}</div></div>
			</div>
			<div class="card">
				<div class="card-head"><span class="card-title">${amIcon("box")} Currently holding</span>
					${can && cur.length > 1 ? `<button class="btn sm" data-act="return-all">${amIcon("ret")} Return all (${cur.length})</button>` : ""}</div>
				${cur.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Type</th><th>Serial / licence</th><th>Since</th><th>Warranty / renewal</th><th class="num"></th></tr></thead><tbody>
					${cur.map((a) => `<tr class="click" data-go="asset|${amEsc(a.name)}">
						<td class="strong">${amEsc(a.name)}${amPath(a)}</td>
						<td>${amPill(a.category_type)}</td>
						<td>${amEsc(a.serial_no || "—")}</td>
						<td class="nowrap">${amDate(a.assigned_on)}</td>
						<td>${this.expiryHtml(a)}</td>
						<td class="num">${can ? `<button class="btn sm" data-act="return" data-n="${amEsc(a.name)}">${amIcon("ret")} Return</button>` : ""}</td>
					</tr>`).join("")}
				</tbody></table></div>` : `<div class="empty">${amEsc(e.employee_name)} holds no assets.</div>`}
			</div>
			<div class="card">
				<div class="card-head"><span class="card-title">${amIcon("clock")} History</span></div>
				${d.history.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Assigned</th><th>Returned</th><th>Asset Movement</th><th>Status</th></tr></thead><tbody>
					${d.history.map((h) => `<tr class="click" data-go="asset|${amEsc(h.asset)}">
						<td class="strong">${amEsc(h.asset)}<span class="sub">${amEsc(h.category || "")}</span></td>
						<td class="nowrap">${amDate(h.assigned_on)}</td>
						<td class="nowrap">${amDate(h.returned_on) || '<span class="faint">—</span>'}</td>
						<td class="muted small">${amEsc(h.movement)}</td>
						<td>${amPill(h.status)}</td>
					</tr>`).join("")}
				</tbody></table></div>` : `<div class="empty">No assignments yet.</div>`}
			</div>`;
	}
	onAct(act, el) {
		const e = this.data.employee;
		if (act === "assign") this.app.assignDialog({ employee: e.name });
		else if (act === "return") this.app.returnDialog({ assets: [el.dataset.n], holder: e.employee_name });
		else if (act === "return-all") this.app.returnDialog({ assets: this.data.current.map((a) => a.name), holder: e.employee_name });
	}
}

// ------------------------------------------------------------------ asset register

class AmAssetsView extends AmView {
	constructor(app) {
		super(app);
		this.filters = Object.assign({ search: "", category: "", sub_category: "", status: "" }, app._assetFilters || {});
	}
	async render(token) {
		const d = await this.api("assets", { filters: this.filters });
		if (this.app.stale(token)) return;
		this.app._assetFilters = this.filters;
		const rows = d.rows;
		const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
		this.main.innerHTML = `
			${this.head("Asset <span>Register</span>", "The standard ERPNext Assets: Category › Sub-category › Item › Asset, who holds each one and when its warranty or renewal is due.",
				this.boot.can_write ? `<button class="btn white" data-act="add">${amIcon("plus")} New asset</button>` : "")}
			${this.filterBar("Search asset, item, serial no or employee")}
			<div class="chips" style="margin-bottom:12px">
				<button class="chip ${this.filters.status ? "" : "on"}" data-act="status" data-s="">All<b>${total}</b></button>
				${AM_STATUSES.map((s) => `<button class="chip ${this.filters.status === s ? "on" : ""}" data-act="status" data-s="${s}">${s}<b>${d.counts[s] || 0}</b></button>`).join("")}
			</div>
			<div class="card">
				${rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Asset</th><th>Item</th><th>Type</th><th>Status</th><th>Assigned to</th><th>Warranty / renewal</th><th class="num">Cost</th></tr></thead><tbody>
					${rows.map((r) => `<tr class="click" data-go="asset|${amEsc(r.name)}">
						<td class="strong">${amEsc(r.name)}${r.serial_no ? `<span class="sub">${amEsc(r.serial_no)}</span>` : ""}</td>
						<td>${amEsc(r.item)}${amPath(r)}</td>
						<td>${amPill(r.category_type)}</td>
						<td>${amPill(r.status)}</td>
						<td>${r.assigned_to ? `${amEsc(r.employee_name || r.assigned_to)}<span class="sub">since ${amDate(r.assigned_on)}</span>` : '<span class="faint">—</span>'}</td>
						<td>${this.expiryHtml(r)}</td>
						<td class="num">${r.purchase_cost ? amInr(r.purchase_cost) + (r.billing_cycle ? `<span class="sub">${r.billing_cycle === "Yearly" ? "per year" : "per month"}</span>` : "") : '<span class="faint">—</span>'}</td>
					</tr>`).join("")}
				</tbody></table></div>` : `<div class="empty">No assets match.</div>`}
			</div>`;
		this.bindFilterBar();
	}
	onAct(act, el) {
		if (act === "status") {
			this.filters.status = el.dataset.s;
			this.reload();
		} else if (act === "add") this.app.newDoc("Asset");
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
		this.main.innerHTML = `
			${this.head(amEsc(a.name),
				`<span>${amEsc(a.category)} › ${amEsc(a.sub_category)} › ${amEsc(a.item)}</span>${amPill(a.category_type)}${amPill(a.status)}`,
				`${can && a.status === "Available" ? `<button class="btn white" data-act="assign">${amIcon("user")} Assign</button>` : ""}
				${can && a.status === "Assigned" ? `<button class="btn white" data-act="return">${amIcon("ret")} Return</button>` : ""}
				<button class="btn" data-erp="Asset|${amEsc(a.name)}">${amIcon(a.status === "Draft" ? "check" : "edit")} ${a.status === "Draft" ? "Open to submit" : "Open Asset form"}</button>`,
				["assets", "Asset register"])}
			<section class="grid2">
				<div class="card">
					<div class="card-head"><span class="card-title">${amTypeIcon(a.category_type)} Details</span></div>
					<div class="kv">
						<div><div class="k">Category</div><div class="v">${amEsc(a.category)}</div></div>
						<div><div class="k">Sub-category</div><div class="v">${amEsc(a.sub_category)}</div></div>
						<div><div class="k">Item</div><div class="v">${amEsc(a.item)}${d.brand ? ` <span class="faint">· ${amEsc(d.brand)}</span>` : ""}</div></div>
						<div><div class="k">${sub ? "Licence / account ID" : "Serial no"}</div><div class="v">${amEsc(a.serial_no || "—")}</div></div>
						<div><div class="k">${sub ? "Start date" : "Purchase date"}</div><div class="v">${amDate(a.purchase_date) || "—"}</div></div>
						<div><div class="k">Location</div><div class="v">${amEsc(a.location || "—")}</div></div>
						<div><div class="k">ERPNext status</div><div class="v">${amEsc(a.erp_status)}</div></div>
						<div><div class="k">Cost</div><div class="v">${a.purchase_cost ? amInr(a.purchase_cost) + (a.billing_cycle ? (a.billing_cycle === "Yearly" ? " / year" : " / month") : "") : "—"}</div></div>
						<div><div class="k">${sub ? "Renewal date" : "Warranty until"}</div><div class="v">${this.expiryHtml(a)}</div></div>
					</div>
				</div>
				<div class="card">
					<div class="card-head"><span class="card-title">${amIcon("user")} Assigned to</span></div>
					${holder ? `<a data-go="employee|${amEsc(holder.name)}" style="display:block">${this.who(holder.employee_name, [holder.name, holder.designation, amDept(holder.department)].filter(Boolean).join(" · "), holder.image)}</a>
						<div class="hint">Since ${amDate(a.assigned_on)}</div>`
					: `<div class="empty">${a.status === "Available" ? "Not assigned. It is ready to hand out." : `Not assigned: ${amEsc(a.status)}.`}</div>`}
				</div>
			</section>
			<div class="card" style="margin-top:12px">
				<div class="card-head"><span class="card-title">${amIcon("clock")} Assignment history</span></div>
				${d.history.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Employee</th><th>Assigned</th><th>Returned</th><th>Asset Movement</th><th>Status</th></tr></thead><tbody>
					${d.history.map((h) => `<tr class="click" data-go="employee|${amEsc(h.employee)}">
						<td class="strong">${amEsc(h.employee_name || h.employee)}<span class="sub">${amEsc(amDept(h.department) || h.employee)}</span></td>
						<td class="nowrap">${amDate(h.assigned_on)}</td>
						<td class="nowrap">${amDate(h.returned_on) || '<span class="faint">—</span>'}</td>
						<td class="muted small">${amEsc(h.movement)}</td>
						<td>${amPill(h.status)}</td>
					</tr>`).join("")}
				</tbody></table></div>` : `<div class="empty">Never assigned.</div>`}
			</div>`;
	}
	onAct(act) {
		const a = this.data.doc;
		if (act === "assign") this.app.assignDialog({ assets: [a.name] });
		else if (act === "return") this.app.returnDialog({ assets: [a.name], holder: a.employee_name });
	}
}

// ------------------------------------------------------------------ catalogue: categories > sub-categories > items

class AmCatalogueView extends AmView {
	async render(token) {
		const cats = (this.cats = await this.api("catalogue"));
		if (this.app.stale(token)) return;
		const w = this.boot.can_write;
		const edit = (doctype, name) => `<button class="round sm" data-act="open" data-dt="${amEsc(doctype)}" data-n="${amEsc(name)}" title="Open ${amEsc(doctype)}">${amIcon("edit")}</button>`;
		this.main.innerHTML = `
			${this.head("Asset <span>Catalogue</span>", "Standard ERPNext records: Asset Category › Item Group (sub-category) › Fixed Asset Item › Asset (e.g. IT Hardware › Laptop › Macbook Air M1 › Macbook Air M1 - 001). Buttons open the standard forms.",
				w ? `<button class="btn white" data-act="add-category">${amIcon("plus")} Asset Category</button>` : "")}
			${cats.length ? cats.map((c, i) => `
				<div class="card" style="--acc:${AM_COLOURS[i % AM_COLOURS.length]}">
					<div class="card-head">
						<span class="card-title">${amTypeIcon(c.category_type)} ${amEsc(c.name)} ${amPill(c.category_type || "Hardware")}
							<span class="am-count">${c.subs.length} sub-categor${c.subs.length === 1 ? "y" : "ies"} · ${c.subs.reduce((n, s) => n + s.items.reduce((m, it) => m + it.total, 0), 0)} assets</span></span>
						<div class="actions">${w ? `<button class="btn sm" data-act="add-sub" data-c="${amEsc(c.name)}">${amIcon("plus")} Sub-category</button>` : ""}${edit("Asset Category", c.name)}</div>
					</div>
					${c.subs.length ? c.subs.map((s) => `
						<div class="am-sub-head">
							<b>${amEsc(s.name)} <span class="am-count">${s.items.length} item${s.items.length === 1 ? "" : "s"}</span></b>
							<div class="actions">${w ? `<button class="btn sm" data-act="add-item" data-s="${amEsc(s.name)}" data-c="${amEsc(c.name)}">${amIcon("plus")} Item</button>` : ""}${edit("Item Group", s.name)}</div>
						</div>
						${s.items.length ? `<div class="table-wrap"><table class="t compact am-items"><thead><tr><th>Item</th><th>Brand</th><th class="num">Assets</th><th class="num">Assigned</th><th class="num">Available</th><th class="num"></th></tr></thead><tbody>
							${s.items.map((it) => `<tr>
								<td class="strong"><a data-act="item-assets" data-n="${amEsc(it.name)}" data-c="${amEsc(c.name)}" data-s="${amEsc(s.name)}">${amEsc(it.item_name || it.name)}</a></td>
								<td>${amEsc(it.brand || "—")}</td>
								<td class="num strong">${it.total}</td>
								<td class="num">${it.assigned}</td>
								<td class="num">${it.available}</td>
								<td class="num nowrap">${w ? `<button class="btn sm" data-act="add-asset" data-n="${amEsc(it.name)}">${amIcon("plus")} Asset</button> ` : ""}${edit("Item", it.name)}</td>
							</tr>`).join("")}
						</tbody></table></div>` : `<div class="faint small" style="padding:6px 2px 10px">No fixed asset items yet.</div>`}
					`).join("") : `<div class="empty">No sub-categories yet. A sub-category is an Item Group under “${amEsc(c.name)}”.</div>`}
				</div>`).join("") : `<div class="card"><div class="empty">No Asset Categories yet. Add one to start, for example “IT Hardware” or “Subscriptions”.</div></div>`}`;
	}
	async onAct(act, el) {
		const n = el.dataset.n;
		if (act === "open") this.app.openForm(el.dataset.dt, n);
		else if (act === "add-category") this.app.newDoc("Asset Category");
		else if (act === "add-sub") {
			try {
				await this.api("ensure_category_group", { category: el.dataset.c }); // the Item Group the sub-category sits under
				this.app.newDoc("Item Group", { parent_item_group: el.dataset.c, is_group: 0 });
			} catch (err) {
				this.app.toast(err.message, "error");
			}
		} else if (act === "add-item") {
			this.app.newDoc("Item", { item_group: el.dataset.s, asset_category: el.dataset.c, is_fixed_asset: 1, is_stock_item: 0 });
		} else if (act === "add-asset") {
			this.app.newDoc("Asset", { item_code: n });
		} else if (act === "item-assets") {
			this.app._assetFilters = { search: n, category: el.dataset.c, sub_category: el.dataset.s, status: "" };
			this.app.go("assets");
		}
	}
}

// ------------------------------------------------------------------ reports

const AM_API_REPORTS = "asset_management.asset_management.reports.";

class AmReportsView extends AmView {
	constructor(app, name) {
		super(app, name);
		this.key = name || app._reportKey || "employee_cost";
		this.filters = Object.assign({ category: "", department: "", holding: "yes", months: "12", date_from: "", date_to: "" }, app._reportFilters || {});
		this.search = "";
		this.sort = null;
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
		const has = (k) => d.filters.includes(k);
		const opt = (v, l) => ({ value: v, label: l });
		const words = d.title.split(" ");
		this.main.innerHTML = `
			${this.head(`${amEsc(words[0])} <span>${amEsc(words.slice(1).join(" "))}</span>`, amEsc(d.description),
				`<button class="btn" data-act="xl">${amIcon("out")} Excel</button>`)}
			<div class="am-reports">${list.map((r) => `<button class="chip ${r.key === this.key ? "on" : ""}" data-act="report" data-k="${r.key}" title="${amEsc(r.description)}">${amEsc(r.title)}</button>`).join("")}</div>
			<div class="filters">
				<label class="search">${amIcon("search")}<input data-f="q" placeholder="Search this report" value="${amEsc(this.search)}"></label>
				${has("category") ? this.selectHtml("category", this.categoryOptions(), this.filters.category) : ""}
				${has("department") ? this.selectHtml("department", [opt("", "All departments"), ...d.departments.map((x) => opt(x, amDept(x)))], this.filters.department, 190) : ""}
				${has("holding") ? this.selectHtml("holding", [opt("yes", "Employees holding assets"), opt("all", "All active employees")], this.filters.holding, 200) : ""}
				${has("months") ? this.selectHtml("months", [opt("1", "Next 1 month"), opt("3", "Next 3 months"), opt("6", "Next 6 months"), opt("12", "Next 12 months"), opt("24", "Next 24 months")], this.filters.months, 160) : ""}
				${has("dates") ? `<input class="inp sm date-inp" type="date" data-f="date_from" value="${amEsc(this.filters.date_from)}" title="Assigned from" aria-label="From" style="width:auto">
					<input class="inp sm date-inp" type="date" data-f="date_to" value="${amEsc(this.filters.date_to)}" title="Assigned to" aria-label="To" style="width:auto">` : ""}
			</div>
			<div class="kpis">${d.summary.map((t) => `<div class="kpi"><div class="k">${amEsc(t.label)}</div><div class="v ${t.tone || ""}">${this.fmt(t.type, t.value)}</div></div>`).join("")}</div>
			<div class="am-rep-grid">
				${d.chart && d.chart.rows.length ? `<div class="card"><div class="card-head"><span class="card-title">${amIcon("grid")} ${amEsc(d.chart.title)}</span>
					${["employee_cost", "department_cost"].includes(this.key) ? `<span class="muted small">Monthly cost = subscriptions per month + hardware value spread over ${d.hw_life_months} months</span>` : ""}</div>
					<div class="hbars">${this.bars(d.chart)}</div></div>` : ""}
				<div class="card"><div class="rx-body"></div></div>
			</div>`;
		this.drawTable();
		const q = this.$("[data-f=q]");
		let t;
		q.addEventListener("input", () => {
			clearTimeout(t);
			t = setTimeout(() => {
				this.search = q.value.trim().toLowerCase();
				this.drawTable();
			}, 150);
		});
		["category", "department", "holding", "months", "date_from", "date_to"].forEach((k) => {
			const el = this.$(`[data-f=${k}]`);
			if (el) el.addEventListener("change", () => {
				this.filters[k] = el.value;
				this.render((this.app.token = Symbol()));
			});
		});
	}
	fmt(type, v, row, c) {
		if (v == null || v === "") return type === "date" ? '<span class="faint">—</span>' : "";
		switch (type) {
			case "money": return amInr(v);
			case "int": return Math.round(v).toLocaleString("en-IN");
			case "dec": return Number(v).toFixed(1);
			case "pct": return `${Math.round(v)}%`;
			case "date": return amDate(v);
			case "dept": return amEsc(amDept(v));
			case "status": return amPill(v);
			case "bar": return `<div class="bar-cell mini ${c && c.key === "share" ? "" : "lime"}"><i style="width:${Math.min(Math.max(v, 0), 100)}%"></i><span>${Math.round(v)}%</span></div>`;
			case "days": return v < 0 ? `<span class="am-neg">${-v} days ago</span>` : `in ${v} days`;
			default: return amEsc(v);
		}
	}
	bars(chart) {
		const max = Math.max(...chart.rows.map((r) => Math.abs(r.value)), 1e-9);
		return chart.rows.map((r) => `<div class="hbar"><span class="hb-label" title="${amEsc(r.label)}">${amEsc(amDept(r.label) || "—")}</span>
			<span class="hb-track"><i style="width:${(Math.abs(r.value) / max) * 100}%"></i></span>
			<span class="hb-val">${this.fmt(chart.type, r.value)}</span></div>`).join("");
	}
	rows() {
		const d = this.data;
		let rows = d.rows;
		if (this.search) {
			rows = rows.filter((r) => d.columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(this.search) || String(r[c.key + "_sub"] ?? "").toLowerCase().includes(this.search)));
		}
		if (this.sort) {
			const { key, dir } = this.sort;
			rows = [...rows].sort((a, b) => {
				const x = a[key], y = b[key];
				if (typeof x === "number" || typeof y === "number") return ((x || 0) - (y || 0)) * dir;
				return String(x ?? "").localeCompare(String(y ?? "")) * dir;
			});
		}
		return rows;
	}
	drawTable() {
		const d = this.data;
		const rows = this.rows();
		const box = this.$(".rx-body");
		if (!rows.length) {
			box.innerHTML = `<div class="empty">${amEsc(this.search ? "No rows match your search." : d.empty || "No data for these filters.")}</div>`;
			return;
		}
		const num = (c) => ["money", "int", "dec", "pct", "days"].includes(c.type);
		const head = d.columns.map((c) => `<th class="sortable ${num(c) ? "num" : ""}" data-sort="${c.key}">${amEsc(c.label)}${this.sort && this.sort.key === c.key ? `<span class="arr">${this.sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("");
		const body = rows.map((r) => `<tr class="${r._go ? "click" : ""}" ${r._go ? `data-go="${amEsc(r._go)}"` : ""}>${d.columns.map((c) => {
			const sub = c.sub && r[c.key + "_sub"] ? `<span class="sub">${amEsc(r[c.key + "_sub"])}</span>` : "";
			const cls = [num(c) ? "num" : "", c.strong ? "strong" : "", c.tone === "neg" && r[c.key] ? "am-neg" : ""].join(" ");
			return `<td class="${cls}">${this.fmt(c.type, r[c.key], r, c)}${sub}</td>`;
		}).join("")}</tr>`).join("");
		const totals = d.columns.some((c) => c.total)
			? `<tr>${d.columns.map((c, i) => `<td class="${num(c) ? "num" : ""}">${c.total ? this.fmt(c.type, rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0)) : i === 0 ? `Total · ${rows.length} rows` : ""}</td>`).join("")}</tr>`
			: "";
		box.innerHTML = `<div class="table-wrap rx-table"><table class="t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot>${totals}</tfoot></table></div>`;
		box.querySelectorAll("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
			const key = th.dataset.sort;
			this.sort = this.sort && this.sort.key === key ? { key, dir: -this.sort.dir } : { key, dir: num(d.columns.find((c) => c.key === key)) ? -1 : 1 };
			this.drawTable();
		}));
	}
	exportExcel() {
		const d = this.data;
		const rows = this.rows();
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
		const out = rows.map((r) => {
			const line = [];
			d.columns.forEach((c) => {
				line.push(cell(c, r[c.key]));
				if (c.sub) line.push(r[c.key + "_sub"] || "");
			});
			return line;
		});
		amDownload(amXlsx(d.title, header, out), `${d.title} ${frappe.datetime.get_today()}.xlsx`);
		this.app.toast(`Downloaded ${out.length} row${out.length === 1 ? "" : "s"} to Excel.`);
	}
	onAct(act, el) {
		if (act === "report") {
			this.app._reportKey = el.dataset.k;
			this.app.go("reports", el.dataset.k);
		} else if (act === "xl") this.exportExcel();
	}
}

// ------------------------------------------------------------------ Excel (same minimal .xlsx writer as the SOR Workspace)

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
