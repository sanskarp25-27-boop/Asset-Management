# Asset Management

Tracking of assets issued to employees (IT hardware and software subscriptions) for ERPNext v16,
built entirely on ERPNext's standard **Assets** module. There is no separate asset register. The app
adds an **Asset Workspace** page in the standard ERPNext desk UI, cost reports and a few fields on the standard forms.

| Level | Standard record | Example |
|---|---|---|
| Category | Asset Category (custom field *Category Type*: Hardware / Subscription) | IT Hardware |
| Sub-Category | Item Group under a group named after the category | IT Hardware > Laptop |
| Item | Item, non-stock, *Is Fixed Asset* | Macbook Air M1 |
| Asset | Asset, named `<Item Name> - 001` | Macbook Air M1 - 001 |
| Assign / return | Asset Movement: Issue sets the Custodian, Receipt clears it | ACC-ASM-2026-00051 |

User guide: `/assets/asset_management/guide/asset-module-guide.html` on any site with the app installed.

## Install

Needs ERPNext v16.

```bash
cd ~/frappe-bench
bench get-app <repo-url> asset_management     # or copy the folder into apps/ and: bench pip install -e apps/asset_management
bench --site <site> install-app asset_management
bench build --app asset_management             # links /assets/asset_management (the user guide)
bench restart
```

Installing (and every `bench migrate`) runs `asset_management/asset_management/setup.py`:

- Custom fields on **Asset**: Sub-Category (fetched from the item's group), Serial No / Licence ID,
  Warranty / Renewal Date, Billing Cycle. On **Asset Category**: Category Type.
- Asset naming series `.{item_name}. - .###` as the default (the standard `ACC-ASS-.YYYY.-` stays
  selectable); `asset.py` copies the name into *Asset Name* so lists show it.
- Custodian shown as a column and filter in the Asset list.
- An **Asset Workspace** link in the standard Assets sidebar.

## What's in the app

| Path (under `asset_management/asset_management/`) | Purpose |
|---|---|
| `page/asset_workspace/` | The Asset Workspace (`/app/asset-workspace`): dashboard, assign & return, employees, assets, reports, catalogue |
| `api.py` | Page API over Asset, Asset Movement and Employee; assign / return create and submit Asset Movements |
| `reports.py` | 11 reports (cost per employee / department, category, item utilisation, subscription seats, idle assets, renewals, assignment history, ageing, leavers, employee register); `HW_LIFE_MONTHS = 36` |
| `setup.py` | Fields, naming series, list settings and sidebar link (after_install / after_migrate) |
| `asset.py` | Asset doc events for the naming |
| `sample_data.py` | Optional demo data |

The page uses only standard desk components (page head and buttons, page-form filters, form-style tabs, number
cards, `frappe.ui.Dialog` with Link / Date fields, `frappe.Chart`, `frappe.DataTable`), so it follows the user's
ERPNext theme (light / dark) like any other desk page.

## Sample data (demo / staging only)

Two categories, 8 sub-categories, 16 items, 44 submitted assets, 8 sample employees and their Asset
Movements, under the site's default company. Safe to re-run.

```bash
bench --site <site> execute asset_management.asset_management.sample_data.load
```

## Roles

| Action | Roles (standard ERPNext permissions) |
|---|---|
| Open the Asset Workspace | Accounts User, Accounts Manager, Quality Manager, Stock Manager, System Manager |
| Create / submit Assets | Accounts User, Quality Manager |
| Assign / return (submit Asset Movement) | Accounts Manager, Stock Manager, System Manager |

## Uninstall

`bench --site <site> uninstall-app asset_management` removes the page. The custom fields, property
setters and sidebar row stay until deleted by hand; Assets and Asset Movements are standard records
and are kept.
