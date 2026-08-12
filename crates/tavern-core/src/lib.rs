use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub listen: String,
    pub data_dir: PathBuf,
    pub admin_username: String,
    pub admin_password: String,
    pub cookie_secure: bool,
    pub trust_proxy: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            listen: "0.0.0.0:8084".into(),
            data_dir: PathBuf::from("./data"),
            admin_username: "tavern_admin".into(),
            admin_password: "change-me-to-a-strong-password".into(),
            cookie_secure: false,
            trust_proxy: false,
        }
    }
}

impl Config {
    pub fn from_env() -> Self {
        let mut c = Self::default();
        if let Ok(v) = std::env::var("TAVERN_LISTEN") {
            c.listen = v;
        }
        if let Ok(v) = std::env::var("TAVERN_DATA_DIR") {
            c.data_dir = PathBuf::from(v);
        }
        if let Ok(v) = std::env::var("TAVERN_ADMIN_USER") {
            c.admin_username = v;
        }
        if let Ok(v) = std::env::var("TAVERN_ADMIN_PASS") {
            c.admin_password = v;
        }
        c.cookie_secure = env_bool("TAVERN_COOKIE_SECURE");
        c.trust_proxy = env_bool("TAVERN_TRUST_PROXY");
        c
    }

    pub fn ensure_dirs(&self) -> anyhow::Result<()> {
        std::fs::create_dir_all(&self.data_dir)?;
        std::fs::create_dir_all(self.data_dir.join("projects"))?;
        std::fs::create_dir_all(self.data_dir.join("imports"))?;
        std::fs::create_dir_all(self.data_dir.join("exports"))?;
        Ok(())
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("tavern.db")
    }

    pub fn project_assets_dir(&self, project_id: Uuid) -> PathBuf {
        self.data_dir
            .join("projects")
            .join(project_id.to_string())
            .join("assets")
    }
}

fn env_bool(key: &str) -> bool {
    std::env::var(key)
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleType {
    Manuscript,
    Character,
    Encyclopedia,
    Relationship,
    Location,
    Systems,
    Maps,
    Timeline,
    Species,
    Cultures,
    Items,
    Arcs,
    Languages,
    Religions,
    Research,
    Philosophies,
    Calendar,
}

impl ModuleType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manuscript => "manuscript",
            Self::Character => "character",
            Self::Encyclopedia => "encyclopedia",
            Self::Relationship => "relationship",
            Self::Location => "location",
            Self::Systems => "systems",
            Self::Maps => "maps",
            Self::Timeline => "timeline",
            Self::Species => "species",
            Self::Cultures => "cultures",
            Self::Items => "items",
            Self::Arcs => "arcs",
            Self::Languages => "languages",
            Self::Religions => "religions",
            Self::Research => "research",
            Self::Philosophies => "philosophies",
            Self::Calendar => "calendar",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "manuscript" => Some(Self::Manuscript),
            "character" => Some(Self::Character),
            "encyclopedia" => Some(Self::Encyclopedia),
            "relationship" => Some(Self::Relationship),
            "location" => Some(Self::Location),
            "systems" => Some(Self::Systems),
            "maps" | "map" => Some(Self::Maps),
            "timeline" | "timelines" => Some(Self::Timeline),
            "species" | "races" => Some(Self::Species),
            "cultures" | "culture" => Some(Self::Cultures),
            "items" | "item" | "objects" => Some(Self::Items),
            "arcs" | "arc" | "plots" | "plot" => Some(Self::Arcs),
            "languages" | "language" => Some(Self::Languages),
            "religions" | "religion" | "beliefs" => Some(Self::Religions),
            "research" | "notes" => Some(Self::Research),
            "philosophies" | "philosophy" => Some(Self::Philosophies),
            "calendar" | "calendars" => Some(Self::Calendar),
            _ => None,
        }
    }

    pub fn all() -> &'static [ModuleType] {
        &[
            Self::Manuscript,
            Self::Character,
            Self::Encyclopedia,
            Self::Relationship,
            Self::Location,
            Self::Systems,
            Self::Maps,
            Self::Timeline,
            Self::Species,
            Self::Cultures,
            Self::Items,
            Self::Arcs,
            Self::Languages,
            Self::Religions,
            Self::Research,
            Self::Philosophies,
            Self::Calendar,
        ]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PanelType {
    Attributes,
    Text,
    List,
    Stats,
    Image,
    Table,
    Links,
}

impl PanelType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Attributes => "attributes",
            Self::Text => "text",
            Self::List => "list",
            Self::Stats => "stats",
            Self::Image => "image",
            Self::Table => "table",
            Self::Links => "links",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "attributes" => Some(Self::Attributes),
            "text" => Some(Self::Text),
            "list" => Some(Self::List),
            "stats" => Some(Self::Stats),
            "image" => Some(Self::Image),
            "table" => Some(Self::Table),
            "links" => Some(Self::Links),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantRole {
    Owner,
    Editor,
    Viewer,
}

impl GrantRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Editor => "editor",
            Self::Viewer => "viewer",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(Self::Owner),
            "editor" => Some(Self::Editor),
            "viewer" => Some(Self::Viewer),
            _ => None,
        }
    }

    pub fn can_edit(self) -> bool {
        matches!(self, Self::Owner | Self::Editor)
    }

    pub fn can_manage(self) -> bool {
        matches!(self, Self::Owner)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub is_admin: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: Uuid,
    pub title: String,
    pub synopsis: String,
    pub owner_id: Uuid,
    pub theme_json: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectGrant {
    pub project_id: Uuid,
    pub user_id: Uuid,
    pub role: GrantRole,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Element {
    pub id: Uuid,
    pub project_id: Uuid,
    pub module_type: ModuleType,
    pub title: String,
    pub parent_id: Option<Uuid>,
    pub sort_order: i64,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub id: Uuid,
    pub element_id: Uuid,
    pub title: String,
    pub sort_order: i64,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelLayout {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Panel {
    pub id: Uuid,
    pub page_id: Uuid,
    pub panel_type: PanelType,
    pub title: String,
    pub border_color: Option<String>,
    pub layout: PanelLayout,
    pub content: serde_json::Value,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElementLink {
    pub id: Uuid,
    pub project_id: Uuid,
    pub from_element_id: Uuid,
    pub to_element_id: Uuid,
    pub label: String,
    pub link_type: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub owner_id: Uuid,
    pub module_type: ModuleType,
    pub name: String,
    pub description: String,
    pub pages_json: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

/// Intermediate JSON format for Campfire-style imports (owned by Tavern).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntermediateProject {
    pub title: String,
    pub synopsis: String,
    pub elements: Vec<IntermediateElement>,
    pub links: Vec<IntermediateLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntermediateElement {
    pub module_type: String,
    pub title: String,
    pub parent_title: Option<String>,
    pub metadata: serde_json::Value,
    pub body_markdown: Option<String>,
    pub panels: Vec<IntermediatePanel>,
    pub unsupported_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntermediatePanel {
    pub panel_type: String,
    pub title: String,
    pub content: serde_json::Value,
    pub layout: Option<PanelLayout>,
    /// Campfire page name this panel belonged to (preserved on HTML import).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntermediateLink {
    pub from_title: String,
    pub to_title: String,
    pub label: String,
    pub link_type: String,
}

pub fn default_theme() -> serde_json::Value {
    serde_json::json!({
        "ink": "#1c2421",
        "stone": "#e6e9e6",
        "moss": "#3d6b54",
        "copper": "#b87333"
    })
}

pub fn default_panel_layout(index: usize) -> PanelLayout {
    default_panel_layout_for("text", index)
}

/// Default grid size large enough for each panel's primary controls
/// (rowHeight ≈ 36px in the UI).
pub fn default_panel_layout_for(panel_type: &str, index: usize) -> PanelLayout {
    let col = (index % 2) as f64;
    let (w, h) = match panel_type {
        "text" => (6.0, 8.0),
        "attributes" | "stats" | "list" => (6.0, 6.0),
        "table" => (6.0, 6.0),
        "image" => (6.0, 7.0),
        "links" => (6.0, 5.0),
        _ => (6.0, 6.0),
    };
    let row = (index / 2) as f64;
    PanelLayout {
        x: col * 6.0,
        y: row * (h + 0.5),
        w,
        h,
    }
}

pub fn default_template_pages(module: ModuleType) -> serde_json::Value {
    match module {
        ModuleType::Manuscript => serde_json::json!([]),
        ModuleType::Character => serde_json::json!([{
            "title": "Overview",
            "panels": [
                {"panel_type": "attributes", "title": "Basics", "content": {"items": [
                    {"key": "Role", "value": ""},
                    {"key": "Age", "value": ""},
                    {"key": "Species", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Backstory", "content": {"markdown": ""}},
                {"panel_type": "list", "title": "Traits", "content": {"items": []}},
                {"panel_type": "links", "title": "Connections", "content": {"element_ids": []}}
            ]
        }]),
        ModuleType::Encyclopedia => serde_json::json!([{
            "title": "Article",
            "panels": [
                {"panel_type": "text", "title": "Entry", "content": {"markdown": ""}},
                {"panel_type": "attributes", "title": "Facts", "content": {"items": []}}
            ]
        }]),
        ModuleType::Relationship => serde_json::json!([{
            "title": "Web",
            "panels": [
                {"panel_type": "text", "title": "Notes", "content": {"markdown": ""}},
                {"panel_type": "links", "title": "Members", "content": {"element_ids": []}}
            ]
        }]),
        ModuleType::Location => serde_json::json!([{
            "title": "Place",
            "panels": [
                {"panel_type": "attributes", "title": "Details", "content": {"items": [
                    {"key": "Region", "value": ""},
                    {"key": "Climate", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Description", "content": {"markdown": ""}},
                {"panel_type": "image", "title": "References", "content": {"images": []}}
            ]
        }]),
        ModuleType::Systems => serde_json::json!([{
            "title": "System",
            "panels": [
                {"panel_type": "attributes", "title": "Classification", "content": {"items": [
                    {"key": "Kind", "value": "magic"},
                    {"key": "Source", "value": ""},
                    {"key": "Cost", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Rules", "content": {"markdown": ""}},
                {"panel_type": "stats", "title": "Metrics", "content": {"items": []}},
                {"panel_type": "table", "title": "Examples", "content": {"headers": ["Name", "Effect"], "rows": []}}
            ]
        }]),
        ModuleType::Maps => serde_json::json!([{
            "title": "Legend",
            "panels": [
                {"panel_type": "text", "title": "Notes", "content": {"markdown": ""}},
                {"panel_type": "list", "title": "Regions", "content": {"items": []}}
            ]
        }]),
        ModuleType::Timeline => serde_json::json!([{
            "title": "Event",
            "panels": [
                {"panel_type": "attributes", "title": "When", "content": {"items": [
                    {"key": "Date", "value": ""},
                    {"key": "Era", "value": ""}
                ]}},
                {"panel_type": "text", "title": "What happened", "content": {"markdown": ""}}
            ]
        }]),
        ModuleType::Species => serde_json::json!([{
            "title": "Overview",
            "panels": [
                {"panel_type": "attributes", "title": "Basics", "content": {"items": [
                    {"key": "Type", "value": ""},
                    {"key": "Lifespan", "value": ""},
                    {"key": "Home range", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Description", "content": {"markdown": ""}},
                {"panel_type": "list", "title": "Traits", "content": {"items": []}},
                {"panel_type": "image", "title": "References", "content": {"images": []}}
            ]
        }]),
        ModuleType::Cultures => serde_json::json!([{
            "title": "Overview",
            "panels": [
                {"panel_type": "attributes", "title": "Basics", "content": {"items": [
                    {"key": "Region", "value": ""},
                    {"key": "Language", "value": ""},
                    {"key": "Era", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Customs", "content": {"markdown": ""}},
                {"panel_type": "list", "title": "Values", "content": {"items": []}},
                {"panel_type": "links", "title": "Related", "content": {"element_ids": []}}
            ]
        }]),
        ModuleType::Items => serde_json::json!([{
            "title": "Object",
            "panels": [
                {"panel_type": "attributes", "title": "Details", "content": {"items": [
                    {"key": "Kind", "value": ""},
                    {"key": "Rarity", "value": ""},
                    {"key": "Owner", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Description", "content": {"markdown": ""}},
                {"panel_type": "image", "title": "Appearance", "content": {"images": []}},
                {"panel_type": "list", "title": "Properties", "content": {"items": []}}
            ]
        }]),
        ModuleType::Arcs => serde_json::json!([{
            "title": "Arc",
            "panels": [
                {"panel_type": "attributes", "title": "Basics", "content": {"items": [
                    {"key": "Type", "value": "plot"},
                    {"key": "Status", "value": "draft"},
                    {"key": "Stakes", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Summary", "content": {"markdown": ""}},
                {"panel_type": "list", "title": "Beats", "content": {"items": []}},
                {"panel_type": "links", "title": "Cast & places", "content": {"element_ids": []}}
            ]
        }]),
        ModuleType::Languages => serde_json::json!([{
            "title": "Language",
            "panels": [
                {"panel_type": "attributes", "title": "Basics", "content": {"items": [
                    {"key": "Family", "value": ""},
                    {"key": "Script", "value": ""},
                    {"key": "Speakers", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Notes", "content": {"markdown": ""}},
                {"panel_type": "table", "title": "Lexicon", "content": {"headers": ["Word", "Meaning"], "rows": []}},
                {"panel_type": "list", "title": "Phonology notes", "content": {"items": []}}
            ]
        }]),
        ModuleType::Religions => serde_json::json!([{
            "title": "Faith",
            "panels": [
                {"panel_type": "attributes", "title": "Basics", "content": {"items": [
                    {"key": "Domain", "value": ""},
                    {"key": "Symbol", "value": ""},
                    {"key": "Center", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Beliefs", "content": {"markdown": ""}},
                {"panel_type": "list", "title": "Rites", "content": {"items": []}},
                {"panel_type": "links", "title": "Related", "content": {"element_ids": []}}
            ]
        }]),
        ModuleType::Research => serde_json::json!([{
            "title": "Notes",
            "panels": [
                {"panel_type": "attributes", "title": "Source", "content": {"items": [
                    {"key": "Topic", "value": ""},
                    {"key": "Status", "value": "open"},
                    {"key": "Priority", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Findings", "content": {"markdown": ""}},
                {"panel_type": "list", "title": "Questions", "content": {"items": []}},
                {"panel_type": "links", "title": "Related lore", "content": {"element_ids": []}}
            ]
        }]),
        ModuleType::Philosophies => serde_json::json!([{
            "title": "School",
            "panels": [
                {"panel_type": "attributes", "title": "Basics", "content": {"items": [
                    {"key": "School", "value": ""},
                    {"key": "Era", "value": ""},
                    {"key": "Influence", "value": ""}
                ]}},
                {"panel_type": "text", "title": "Tenets", "content": {"markdown": ""}},
                {"panel_type": "list", "title": "Thinkers", "content": {"items": []}},
                {"panel_type": "links", "title": "Related", "content": {"element_ids": []}}
            ]
        }]),
        ModuleType::Calendar => serde_json::json!([{
            "title": "Calendar",
            "panels": [
                {"panel_type": "attributes", "title": "Basics", "content": {"items": [
                    {"key": "Epoch", "value": ""},
                    {"key": "Year length", "value": ""},
                    {"key": "Used by", "value": ""}
                ]}},
                {"panel_type": "table", "title": "Months", "content": {"headers": ["Name", "Days", "Notes"], "rows": []}},
                {"panel_type": "list", "title": "Eras", "content": {"items": []}},
                {"panel_type": "list", "title": "Holidays", "content": {"items": []}},
                {"panel_type": "text", "title": "Notes", "content": {"markdown": ""}}
            ]
        }]),
    }
}
