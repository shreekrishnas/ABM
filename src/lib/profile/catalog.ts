// Technology catalog: one canonical name per product, the words people use for it, its category,
// and (where a website gives it away) the script, tag or path that proves it is installed.
// Website detection only covers what a public site can show (CRM forms, marketing automation,
// analytics, CMS, commerce, CDN, chat). Back-office systems (ERP, MDM, HR) come from job posts,
// case studies and press, or a tech-lookup provider.

export type TechCategory =
  | "erp" | "crm" | "marketing_automation" | "mdm" | "workflow" | "kyc_esign" | "analytics" | "data_platform"
  | "ecommerce" | "cms" | "cloud" | "hr" | "collaboration" | "security" | "customer_support" | "other";

export const CATEGORY_LABEL: Record<TechCategory, string> = {
  erp: "ERP", crm: "CRM", marketing_automation: "Marketing automation", mdm: "Master data", workflow: "Workflow and automation",
  kyc_esign: "KYC and e-sign", analytics: "Web analytics", data_platform: "Data and BI", ecommerce: "Commerce", cms: "Website CMS",
  cloud: "Cloud and CDN", hr: "HR", collaboration: "Collaboration", security: "Security and consent", customer_support: "Support and chat", other: "Other",
};

/** Order categories are shown in: what matters most to an enterprise sale first. */
export const CATEGORY_ORDER: TechCategory[] = ["erp", "crm", "mdm", "workflow", "kyc_esign", "marketing_automation", "data_platform", "hr", "customer_support", "ecommerce", "analytics", "cms", "cloud", "collaboration", "security", "other"];

export interface TechEntry {
  name: string;
  vendor: string;
  category: TechCategory;
  /** Lowercase words or phrases that name it in text (matched on word boundaries). */
  aliases: string[];
  /** Evidence in a page's HTML that it is installed (script src, tag, path). */
  web?: RegExp[];
}

export const TECH: TechEntry[] = [
  // ── ERP ──
  { name: "SAP S/4HANA", vendor: "SAP", category: "erp", aliases: ["s/4hana", "s4hana", "s/4 hana", "s4 hana", "rise with sap", "sap s/4"] },
  { name: "SAP ECC", vendor: "SAP", category: "erp", aliases: ["sap ecc", "sap r/3", "ecc 6.0", "sap erp"] },
  { name: "SAP Business One", vendor: "SAP", category: "erp", aliases: ["sap business one", "sap b1"] },
  { name: "SAP ByDesign", vendor: "SAP", category: "erp", aliases: ["sap business bydesign", "sap bydesign"] },
  { name: "Oracle E-Business Suite", vendor: "Oracle", category: "erp", aliases: ["oracle e-business suite", "oracle ebs", "oracle apps r12", "oracle r12"] },
  { name: "Oracle Fusion Cloud ERP", vendor: "Oracle", category: "erp", aliases: ["oracle fusion", "oracle cloud erp", "fusion erp", "oracle erp cloud"] },
  { name: "Oracle NetSuite", vendor: "Oracle", category: "erp", aliases: ["netsuite"] },
  { name: "JD Edwards", vendor: "Oracle", category: "erp", aliases: ["jd edwards", "jde enterpriseone"] },
  { name: "Microsoft Dynamics 365 Finance & Operations", vendor: "Microsoft", category: "erp", aliases: ["dynamics 365 finance", "dynamics 365 f&o", "d365 f&o", "dynamics ax", "d365fo"] },
  { name: "Microsoft Dynamics 365 Business Central", vendor: "Microsoft", category: "erp", aliases: ["business central", "dynamics nav", "navision"] },
  { name: "Infor CloudSuite", vendor: "Infor", category: "erp", aliases: ["infor cloudsuite", "infor ln", "infor m3", "infor syteline", "baan"] },
  { name: "Epicor ERP", vendor: "Epicor", category: "erp", aliases: ["epicor"] },
  { name: "IFS Cloud", vendor: "IFS", category: "erp", aliases: ["ifs cloud", "ifs applications"] },
  { name: "Tally", vendor: "Tally Solutions", category: "erp", aliases: ["tally erp", "tallyprime", "tally prime", "tally erp 9"] },
  { name: "Ramco ERP", vendor: "Ramco Systems", category: "erp", aliases: ["ramco erp", "ramco systems"] },
  { name: "Odoo", vendor: "Odoo", category: "erp", aliases: ["odoo"] },
  // ── CRM ──
  { name: "Salesforce", vendor: "Salesforce", category: "crm", aliases: ["salesforce", "sales cloud", "sfdc", "salesforce crm", "service cloud"], web: [/\.force\.com\b/i, /sfdcstatic\.com/i, /salesforceliveagent|liveagent\.salesforce/i, /webto(?:lead|case)\b/i] },
  { name: "HubSpot", vendor: "HubSpot", category: "crm", aliases: ["hubspot"], web: [/js\.hs-scripts\.com/i, /js\.hsforms\.net/i, /js\.hs-analytics\.net/i, /js\.hubspot\.com/i, /hs-banner\.com/i] },
  { name: "Zoho CRM", vendor: "Zoho", category: "crm", aliases: ["zoho crm", "zoho one"], web: [/crm\.zoho\.(?:com|in|eu)/i, /zohopublic\.(?:com|in)/i, /salesiq\.zoho/i] },
  { name: "Microsoft Dynamics 365 Sales", vendor: "Microsoft", category: "crm", aliases: ["dynamics 365 sales", "dynamics crm", "dynamics 365 crm", "ms crm"], web: [/\.dynamics\.com\/[a-z0-9/]*(?:form|webresources)/i] },
  { name: "Freshsales", vendor: "Freshworks", category: "crm", aliases: ["freshsales", "freshworks crm"], web: [/freshsales\.io/i] },
  { name: "LeadSquared", vendor: "LeadSquared", category: "crm", aliases: ["leadsquared"], web: [/leadsquared\.com/i, /lsqpath|lsq\.js/i] },
  { name: "Pipedrive", vendor: "Pipedrive", category: "crm", aliases: ["pipedrive"], web: [/pipedrive\.com\/(?:leadbooster|web-forms)/i] },
  { name: "SAP Sales Cloud", vendor: "SAP", category: "crm", aliases: ["sap sales cloud", "sap c/4hana", "sap cx", "sap crm", "sap hybris c4c"] },
  { name: "Oracle Siebel", vendor: "Oracle", category: "crm", aliases: ["siebel"] },
  // ── Marketing automation ──
  { name: "Adobe Marketo Engage", vendor: "Adobe", category: "marketing_automation", aliases: ["marketo"], web: [/munchkin\.marketo\.net/i, /mktoresp\.com/i, /marketo\.com\/js/i, /mktoForms/i] },
  { name: "Salesforce Account Engagement (Pardot)", vendor: "Salesforce", category: "marketing_automation", aliases: ["pardot", "account engagement"], web: [/pi\.pardot\.com/i, /go\.pardot\.com/i, /piAId\s*=/i] },
  { name: "Oracle Eloqua", vendor: "Oracle", category: "marketing_automation", aliases: ["eloqua"], web: [/elqcfg\.min\.js|elqCfg/i, /\.eloqua\.com/i, /\.en25\.com/i] },
  { name: "MoEngage", vendor: "MoEngage", category: "marketing_automation", aliases: ["moengage"], web: [/cdn\.moengage\.com/i, /moe_data|Moengage\s*=/i] },
  { name: "CleverTap", vendor: "CleverTap", category: "marketing_automation", aliases: ["clevertap"], web: [/clevertap(?:-prod)?\.com/i, /wzrk/i] },
  { name: "WebEngage", vendor: "WebEngage", category: "marketing_automation", aliases: ["webengage"], web: [/widgets\.in\.webengage\.com|webengage\.com\/js/i] },
  { name: "Netcore Smartech", vendor: "Netcore", category: "marketing_automation", aliases: ["netcore smartech", "netcore cloud"], web: [/netcoresmartech\.com|smartechcdn|cdnt\.netcoresmartech/i] },
  { name: "Mailchimp", vendor: "Intuit", category: "marketing_automation", aliases: ["mailchimp"], web: [/chimpstatic\.com/i, /list-manage\.com/i] },
  { name: "Braze", vendor: "Braze", category: "marketing_automation", aliases: ["braze"], web: [/js\.appboycdn\.com|sdk\.iad-\d+\.braze\.com/i] },
  { name: "Adobe Campaign", vendor: "Adobe", category: "marketing_automation", aliases: ["adobe campaign"] },
  // ── Master data ──
  { name: "Informatica MDM", vendor: "Informatica", category: "mdm", aliases: ["informatica mdm", "informatica master data", "informatica 360", "informatica customer 360", "informatica supplier 360"] },
  { name: "SAP Master Data Governance", vendor: "SAP", category: "mdm", aliases: ["sap mdg", "master data governance"] },
  { name: "Reltio", vendor: "Reltio", category: "mdm", aliases: ["reltio"] },
  { name: "Stibo STEP", vendor: "Stibo Systems", category: "mdm", aliases: ["stibo", "stibo step"] },
  { name: "Profisee", vendor: "Profisee", category: "mdm", aliases: ["profisee"] },
  { name: "TIBCO EBX", vendor: "TIBCO", category: "mdm", aliases: ["tibco ebx"] },
  { name: "Semarchy xDM", vendor: "Semarchy", category: "mdm", aliases: ["semarchy"] },
  { name: "Talend Data Fabric", vendor: "Qlik", category: "data_platform", aliases: ["talend"] },
  { name: "Ataccama ONE", vendor: "Ataccama", category: "mdm", aliases: ["ataccama"] },
  // ── Workflow and automation ──
  { name: "ServiceNow", vendor: "ServiceNow", category: "workflow", aliases: ["servicenow"] },
  { name: "Appian", vendor: "Appian", category: "workflow", aliases: ["appian"] },
  { name: "Pega", vendor: "Pegasystems", category: "workflow", aliases: ["pega", "pegasystems", "pega bpm"] },
  { name: "Microsoft Power Apps", vendor: "Microsoft", category: "workflow", aliases: ["power apps", "powerapps", "power platform", "power automate"] },
  { name: "Mendix", vendor: "Siemens", category: "workflow", aliases: ["mendix"] },
  { name: "OutSystems", vendor: "OutSystems", category: "workflow", aliases: ["outsystems"] },
  { name: "Kissflow", vendor: "Kissflow", category: "workflow", aliases: ["kissflow"] },
  { name: "Nintex", vendor: "Nintex", category: "workflow", aliases: ["nintex"] },
  { name: "UiPath", vendor: "UiPath", category: "workflow", aliases: ["uipath"] },
  { name: "Automation Anywhere", vendor: "Automation Anywhere", category: "workflow", aliases: ["automation anywhere"] },
  // ── KYC and e-sign ──
  { name: "DocuSign", vendor: "DocuSign", category: "kyc_esign", aliases: ["docusign"], web: [/docusign\.(?:net|com)\/(?:js|clickapi)/i] },
  { name: "Adobe Acrobat Sign", vendor: "Adobe", category: "kyc_esign", aliases: ["adobe sign", "acrobat sign", "echosign"] },
  { name: "Leegality", vendor: "Leegality", category: "kyc_esign", aliases: ["leegality"] },
  { name: "Digio", vendor: "Digio", category: "kyc_esign", aliases: ["digio"] },
  { name: "Signzy", vendor: "Signzy", category: "kyc_esign", aliases: ["signzy"] },
  { name: "IDfy", vendor: "IDfy", category: "kyc_esign", aliases: ["idfy"] },
  { name: "eMudhra", vendor: "eMudhra", category: "kyc_esign", aliases: ["emudhra"] },
  // ── Data and BI ──
  { name: "Informatica (data integration)", vendor: "Informatica", category: "data_platform", aliases: ["informatica", "informatica powercenter", "informatica idmc", "informatica cloud"] },
  { name: "Snowflake", vendor: "Snowflake", category: "data_platform", aliases: ["snowflake"] },
  { name: "Databricks", vendor: "Databricks", category: "data_platform", aliases: ["databricks"] },
  { name: "Microsoft Power BI", vendor: "Microsoft", category: "data_platform", aliases: ["power bi", "powerbi"] },
  { name: "Tableau", vendor: "Salesforce", category: "data_platform", aliases: ["tableau"] },
  { name: "Qlik Sense", vendor: "Qlik", category: "data_platform", aliases: ["qlik", "qlikview", "qlik sense"] },
  { name: "SAP BW/4HANA", vendor: "SAP", category: "data_platform", aliases: ["sap bw", "bw/4hana", "sap analytics cloud"] },
  // ── HR ──
  { name: "Workday", vendor: "Workday", category: "hr", aliases: ["workday"] },
  { name: "SAP SuccessFactors", vendor: "SAP", category: "hr", aliases: ["successfactors"], web: [/successfactors\.(?:com|eu)\/career/i] },
  { name: "Oracle HCM Cloud", vendor: "Oracle", category: "hr", aliases: ["oracle hcm", "oracle taleo", "taleo"], web: [/taleo\.net/i] },
  { name: "Darwinbox", vendor: "Darwinbox", category: "hr", aliases: ["darwinbox"], web: [/darwinbox\.in/i] },
  { name: "Keka", vendor: "Keka", category: "hr", aliases: ["keka hr", "keka"] },
  // ── Support and chat ──
  { name: "Zendesk", vendor: "Zendesk", category: "customer_support", aliases: ["zendesk"], web: [/static\.zdassets\.com/i, /\.zendesk\.com\/embeddable/i] },
  { name: "Freshdesk / Freshchat", vendor: "Freshworks", category: "customer_support", aliases: ["freshdesk", "freshchat", "freshservice"], web: [/wchat\.freshchat\.com/i, /freshdesk\.com\/widget/i, /widget\.freshworks\.com/i] },
  { name: "Intercom", vendor: "Intercom", category: "customer_support", aliases: ["intercom"], web: [/widget\.intercom\.io/i, /js\.intercomcdn\.com/i] },
  { name: "Drift", vendor: "Salesloft", category: "customer_support", aliases: ["drift chat"], web: [/js\.driftt\.com/i] },
  { name: "Haptik", vendor: "Haptik", category: "customer_support", aliases: ["haptik"], web: [/haptikapi\.com|toolassets\.haptikapi/i] },
  { name: "Yellow.ai", vendor: "Yellow.ai", category: "customer_support", aliases: ["yellow.ai", "yellow messenger"], web: [/cdn\.yellowmessenger\.com|cloud\.yellow\.ai/i] },
  { name: "Gupshup", vendor: "Gupshup", category: "customer_support", aliases: ["gupshup"], web: [/gupshup\.io/i] },
  { name: "Tawk.to", vendor: "Tawk.to", category: "customer_support", aliases: ["tawk.to"], web: [/embed\.tawk\.to/i] },
  // ── Commerce ──
  { name: "Shopify", vendor: "Shopify", category: "ecommerce", aliases: ["shopify"], web: [/cdn\.shopify\.com/i, /\.myshopify\.com/i] },
  { name: "Adobe Commerce (Magento)", vendor: "Adobe", category: "ecommerce", aliases: ["magento", "adobe commerce"], web: [/\/static\/version\d+\/frontend\//i, /Magento_[A-Z]/] },
  { name: "SAP Commerce Cloud", vendor: "SAP", category: "ecommerce", aliases: ["sap commerce", "hybris"], web: [/\/_ui\/responsive\//i, /hybris/i] },
  { name: "Salesforce Commerce Cloud", vendor: "Salesforce", category: "ecommerce", aliases: ["commerce cloud", "demandware"], web: [/demandware\.(?:static|net)/i, /\/on\/demandware\.store\//i] },
  { name: "WooCommerce", vendor: "Automattic", category: "ecommerce", aliases: ["woocommerce"], web: [/woocommerce/i] },
  // ── Website CMS ──
  { name: "Adobe Experience Manager", vendor: "Adobe", category: "cms", aliases: ["adobe experience manager", "aem"], web: [/\/etc\.clientlibs\//i, /\/content\/dam\//i] },
  { name: "Sitecore", vendor: "Sitecore", category: "cms", aliases: ["sitecore"], web: [/\/-\/media\//i, /sitecore/i] },
  { name: "WordPress", vendor: "Automattic", category: "cms", aliases: ["wordpress"], web: [/\/wp-content\//i, /\/wp-includes\//i] },
  { name: "Drupal", vendor: "Drupal", category: "cms", aliases: ["drupal"], web: [/drupal-settings-json/i, /\/sites\/default\/files\//i, /Drupal\.settings/] },
  { name: "Contentful", vendor: "Contentful", category: "cms", aliases: ["contentful"], web: [/images\.ctfassets\.net/i] },
  { name: "Webflow", vendor: "Webflow", category: "cms", aliases: ["webflow"], web: [/assets(?:-global)?\.website-files\.com/i, /data-wf-site/i] },
  { name: "Wix", vendor: "Wix", category: "cms", aliases: ["wix"], web: [/static\.wixstatic\.com/i] },
  // ── Web analytics ──
  { name: "Google Analytics", vendor: "Google", category: "analytics", aliases: ["google analytics"], web: [/google-analytics\.com\/(?:analytics|ga)\.js/i, /googletagmanager\.com\/gtag\/js/i] },
  { name: "Google Tag Manager", vendor: "Google", category: "analytics", aliases: ["google tag manager"], web: [/googletagmanager\.com\/gtm\.js/i, /GTM-[A-Z0-9]{4,}/] },
  { name: "Adobe Analytics", vendor: "Adobe", category: "analytics", aliases: ["adobe analytics", "omniture"], web: [/assets\.adobedtm\.com/i, /\/b\/ss\//i, /s_code\.js/i] },
  { name: "Segment", vendor: "Twilio", category: "analytics", aliases: ["segment cdp"], web: [/cdn\.segment\.com/i] },
  { name: "Microsoft Clarity", vendor: "Microsoft", category: "analytics", aliases: ["microsoft clarity"], web: [/clarity\.ms\/tag/i] },
  { name: "Hotjar", vendor: "Hotjar", category: "analytics", aliases: ["hotjar"], web: [/static\.hotjar\.com/i] },
  { name: "Mixpanel", vendor: "Mixpanel", category: "analytics", aliases: ["mixpanel"], web: [/cdn\.mxpnl\.com/i] },
  { name: "LinkedIn Insight Tag", vendor: "LinkedIn", category: "analytics", aliases: ["linkedin insight tag"], web: [/snap\.licdn\.com\/li\.lms-analytics/i, /_linkedin_partner_id/i] },
  // ── Cloud and CDN ──
  { name: "Amazon Web Services", vendor: "Amazon", category: "cloud", aliases: ["aws", "amazon web services"], web: [/\.cloudfront\.net/i, /\.s3[.-][a-z0-9-]*\.?amazonaws\.com/i] },
  { name: "Microsoft Azure", vendor: "Microsoft", category: "cloud", aliases: ["microsoft azure", "azure"], web: [/\.azureedge\.net/i, /\.azurewebsites\.net/i, /\.blob\.core\.windows\.net/i] },
  { name: "Google Cloud", vendor: "Google", category: "cloud", aliases: ["google cloud", "gcp"], web: [/storage\.googleapis\.com/i] },
  { name: "Cloudflare", vendor: "Cloudflare", category: "cloud", aliases: ["cloudflare"], web: [/\/cdn-cgi\//i] },
  { name: "Akamai", vendor: "Akamai", category: "cloud", aliases: ["akamai"], web: [/\.akamaihd\.net/i, /\.akamaized\.net/i] },
  // ── Collaboration ──
  { name: "Microsoft 365", vendor: "Microsoft", category: "collaboration", aliases: ["microsoft 365", "office 365", "sharepoint", "microsoft teams"] },
  { name: "Google Workspace", vendor: "Google", category: "collaboration", aliases: ["google workspace", "g suite"] },
  // ── Security and consent ──
  { name: "OneTrust", vendor: "OneTrust", category: "security", aliases: ["onetrust"], web: [/cdn\.cookielaw\.org/i, /optanon/i] },
  { name: "Cookiebot", vendor: "Usercentrics", category: "security", aliases: ["cookiebot"], web: [/consent\.cookiebot\.com/i] },
  { name: "Okta", vendor: "Okta", category: "security", aliases: ["okta"] },
  { name: "Imperva", vendor: "Imperva", category: "security", aliases: ["imperva", "incapsula"], web: [/_Incapsula_Resource/i] },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const ALIAS_RE = TECH.map((t) => ({ t, re: new RegExp(`(^|[^a-z0-9])(?:${t.aliases.map(esc).join("|")})(?![a-z0-9])`, "i") }));

/** Catalog entry for a tool name as written in text ("S/4 HANA" → SAP S/4HANA). Most specific alias wins. */
export function matchTech(raw: string | null | undefined): TechEntry | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const exact = TECH.find((t) => t.name.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  let best: { t: TechEntry; len: number } | null = null;
  for (const { t, re } of ALIAS_RE) {
    const m = s.match(re);
    if (m) {
      const len = m[0].length;
      if (!best || len > best.len) best = { t, len };
    }
  }
  return best?.t ?? null;
}

/** Tool words that name a category, not a product: never stored as a technology on their own. */
export const GENERIC_TECH_WORDS = new Set(["erp", "crm", "mdm", "cloud", "saas", "software", "platform", "bpm", "rpa", "bi", "analytics", "automation", "digital", "ai", "it", "system", "systems", "tools", "workflow"]);
