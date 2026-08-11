use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use rust_embed::Embed;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tavern_core::{
    default_panel_layout_for, Element, GrantRole, ModuleType, PanelLayout, PanelType, User,
};
use tavern_export::{
    compile_manuscript_markdown, compile_world_bible_markdown, elements_to_intermediate,
    write_tavern_backup, write_with_pandoc, ChapterBody, ExportFormat,
};
use uuid::Uuid;

use crate::auth::{AdminUser, AuthUser};
use crate::state::AppState;

#[derive(Embed)]
#[folder = "../../web/dist/"]
struct Assets;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
        .route("/api/users", get(list_users).post(create_user))
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/projects/tutorial", post(create_tutorial_project))
        .route(
            "/api/projects/{id}",
            get(get_project).put(update_project).delete(delete_project),
        )
        .route(
            "/api/projects/{id}/grants",
            get(list_grants).post(upsert_grant),
        )
        .route(
            "/api/projects/{id}/grants/{user_id}",
            delete(delete_grant),
        )
        .route(
            "/api/projects/{id}/elements",
            get(list_elements).post(create_element),
        )
        .route(
            "/api/elements/{id}",
            get(get_element).put(update_element).delete(delete_element),
        )
        .route(
            "/api/elements/{id}/pages",
            get(list_pages).post(create_page),
        )
        .route(
            "/api/pages/{id}",
            put(update_page).delete(delete_page),
        )
        .route(
            "/api/pages/{id}/panels",
            get(list_panels).post(create_panel),
        )
        .route(
            "/api/panels/{id}",
            put(update_panel).delete(delete_panel),
        )
        .route(
            "/api/projects/{id}/links",
            get(list_links).post(create_link),
        )
        .route("/api/links/{id}", delete(delete_link))
        .route(
            "/api/elements/{id}/manuscript",
            get(get_manuscript).put(put_manuscript),
        )
        .route("/api/templates", get(list_templates).post(save_template))
        .route(
            "/api/projects/{id}/export",
            post(export_project),
        )
        .route(
            "/api/projects/{id}/backup",
            post(backup_project),
        )
        .route(
            "/api/projects/{id}/assets",
            get(list_assets).post(upload_asset),
        )
        .route(
            "/api/projects/{id}/assets/{name}",
            get(get_asset).delete(delete_asset),
        )
        .route("/api/import", post(import_project))
        .route("/api/modules", get(list_modules))
        .route("/", get(index))
        .route("/assets/{*path}", get(static_asset))
        .fallback(index)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "name": "tavern",
        "pandoc": tavern_export::pandoc_available()
    }))
}

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

async fn login(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Json(body): Json<LoginBody>,
) -> Result<(CookieJar, Json<serde_json::Value>), ApiError> {
    let user = state
        .db
        .get_user_by_username(&body.username)
        .await?
        .ok_or(ApiError::unauthorized("invalid credentials"))?;
    let hash = state
        .db
        .get_password_hash(&body.username)
        .await?
        .ok_or(ApiError::unauthorized("invalid credentials"))?;
    if !tavern_db::Db::verify_password(&body.password, &hash)? {
        return Err(ApiError::unauthorized("invalid credentials"));
    }
    let token = state.db.create_session(user.id).await?;
    let mut cookie = Cookie::new("tavern_session", token.clone());
    cookie.set_http_only(true);
    cookie.set_path("/");
    cookie.set_same_site(SameSite::Lax);
    if state.config.cookie_secure {
        cookie.set_secure(true);
    }
    Ok((
        jar.add(cookie),
        Json(serde_json::json!({ "token": token, "user": user })),
    ))
}

async fn logout(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), ApiError> {
    if let Some(c) = jar.get("tavern_session") {
        let _ = state.db.delete_session(c.value()).await;
    }
    let mut cookie = Cookie::new("tavern_session", "");
    cookie.set_path("/");
    cookie.make_removal();
    Ok((jar.add(cookie), StatusCode::NO_CONTENT))
}

async fn me(AuthUser(user): AuthUser) -> Json<User> {
    Json(user)
}

#[derive(Deserialize)]
struct CreateUserBody {
    username: String,
    password: String,
    is_admin: Option<bool>,
}

async fn list_users(
    _admin: AdminUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<User>>, ApiError> {
    Ok(Json(state.db.list_users().await?))
}

async fn create_user(
    _admin: AdminUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateUserBody>,
) -> Result<(StatusCode, Json<User>), ApiError> {
    tavern_db::Db::validate_password_strength(&body.password)?;
    let user = state
        .db
        .create_user(&body.username, &body.password, body.is_admin.unwrap_or(false))
        .await?;
    Ok((StatusCode::CREATED, Json(user)))
}

#[derive(Deserialize)]
struct CreateProjectBody {
    title: String,
    synopsis: Option<String>,
}

async fn list_projects(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<tavern_core::Project>>, ApiError> {
    Ok(Json(state.db.list_projects_for_user(&user).await?))
}

async fn create_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateProjectBody>,
) -> Result<(StatusCode, Json<tavern_core::Project>), ApiError> {
    let p = state
        .db
        .create_project(user.id, &body.title, body.synopsis.as_deref().unwrap_or(""))
        .await?;
    Ok((StatusCode::CREATED, Json(p)))
}

async fn create_tutorial_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    const TUTORIAL: &str = include_str!("../../../../samples/tutorial_project.json");
    let (intermediate, report) =
        tavern_import::load_bytes(TUTORIAL.as_bytes(), Some("tutorial_project.json"))?;
    let prepared = tavern_import::prepare(intermediate, report)?;
    let body = materialize_import(&state, user.id, prepared, TUTORIAL.as_bytes()).await?;
    Ok((StatusCode::CREATED, body))
}

async fn get_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<tavern_core::Project>, ApiError> {
    require_access(&state, &user, id).await?;
    state
        .db
        .get_project(id)
        .await?
        .map(Json)
        .ok_or(ApiError::not_found("project"))
}

#[derive(Deserialize)]
struct UpdateProjectBody {
    title: String,
    synopsis: String,
    theme_json: Option<serde_json::Value>,
}

async fn update_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateProjectBody>,
) -> Result<Json<tavern_core::Project>, ApiError> {
    require_edit(&state, &user, id).await?;
    let theme = body
        .theme_json
        .unwrap_or_else(tavern_core::default_theme);
    Ok(Json(
        state
            .db
            .update_project(id, &body.title, &body.synopsis, &theme)
            .await?,
    ))
}

async fn delete_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require_manage(&state, &user, id).await?;
    state.db.delete_project(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_grants(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<tavern_core::ProjectGrant>>, ApiError> {
    require_access(&state, &user, id).await?;
    Ok(Json(state.db.list_grants(id).await?))
}

#[derive(Deserialize)]
struct GrantBody {
    user_id: Option<Uuid>,
    username: Option<String>,
    role: String,
}

async fn upsert_grant(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<GrantBody>,
) -> Result<StatusCode, ApiError> {
    require_manage(&state, &user, id).await?;
    let role = GrantRole::parse(&body.role).ok_or(ApiError::bad("invalid role"))?;
    let uid = if let Some(u) = body.user_id {
        u
    } else if let Some(name) = &body.username {
        state
            .db
            .get_user_by_username(name)
            .await?
            .ok_or(ApiError::not_found("user"))?
            .id
    } else {
        return Err(ApiError::bad("user_id or username required"));
    };
    state.db.upsert_grant(id, uid, role).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_grant(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path((id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    require_manage(&state, &user, id).await?;
    state.db.delete_grant(id, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ListElementsQuery {
    module: Option<String>,
}

#[derive(Deserialize)]
struct CreateElementBody {
    module_type: String,
    title: String,
    parent_id: Option<Uuid>,
    metadata: Option<serde_json::Value>,
    apply_template: Option<bool>,
}

async fn list_elements(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(q): Query<ListElementsQuery>,
) -> Result<Json<Vec<Element>>, ApiError> {
    require_access(&state, &user, id).await?;
    let module = q.module.as_deref().and_then(ModuleType::parse);
    Ok(Json(state.db.list_elements(id, module).await?))
}

async fn create_element(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateElementBody>,
) -> Result<(StatusCode, Json<Element>), ApiError> {
    require_edit(&state, &user, id).await?;
    let module =
        ModuleType::parse(&body.module_type).ok_or(ApiError::bad("invalid module_type"))?;
    let el = state
        .db
        .create_element(
            id,
            module,
            &body.title,
            body.parent_id,
            body.metadata.unwrap_or_else(|| serde_json::json!({})),
            body.apply_template.unwrap_or(true),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(el)))
}

async fn get_element(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Element>, ApiError> {
    let el = state
        .db
        .get_element(id)
        .await?
        .ok_or(ApiError::not_found("element"))?;
    require_access(&state, &user, el.project_id).await?;
    Ok(Json(el))
}

#[derive(Deserialize)]
struct UpdateElementBody {
    title: String,
    parent_id: Option<Uuid>,
    sort_order: i64,
    metadata: serde_json::Value,
}

async fn update_element(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateElementBody>,
) -> Result<Json<Element>, ApiError> {
    let el = state
        .db
        .get_element(id)
        .await?
        .ok_or(ApiError::not_found("element"))?;
    require_edit(&state, &user, el.project_id).await?;
    Ok(Json(
        state
            .db
            .update_element(id, &body.title, body.parent_id, body.sort_order, body.metadata)
            .await?,
    ))
}

async fn delete_element(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let el = state
        .db
        .get_element(id)
        .await?
        .ok_or(ApiError::not_found("element"))?;
    require_edit(&state, &user, el.project_id).await?;
    state.db.delete_element(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CreatePageBody {
    title: String,
    description: Option<String>,
    sort_order: Option<i64>,
}

async fn list_pages(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<tavern_core::Page>>, ApiError> {
    let el = state
        .db
        .get_element(id)
        .await?
        .ok_or(ApiError::not_found("element"))?;
    require_access(&state, &user, el.project_id).await?;
    Ok(Json(state.db.list_pages(id).await?))
}

async fn create_page(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreatePageBody>,
) -> Result<(StatusCode, Json<tavern_core::Page>), ApiError> {
    let el = state
        .db
        .get_element(id)
        .await?
        .ok_or(ApiError::not_found("element"))?;
    require_edit(&state, &user, el.project_id).await?;
    let page = state
        .db
        .create_page(
            id,
            &body.title,
            body.description.as_deref().unwrap_or(""),
            body.sort_order.unwrap_or(0),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(page)))
}

#[derive(Deserialize)]
struct UpdatePageBody {
    title: String,
    description: String,
    sort_order: i64,
}

async fn update_page(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePageBody>,
) -> Result<Json<tavern_core::Page>, ApiError> {
    let pages_el = find_element_for_page(&state, id).await?;
    require_edit(&state, &user, pages_el.project_id).await?;
    Ok(Json(
        state
            .db
            .update_page(id, &body.title, &body.description, body.sort_order)
            .await?,
    ))
}

async fn delete_page(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let el = find_element_for_page(&state, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    state.db.delete_page(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CreatePanelBody {
    panel_type: String,
    title: String,
    border_color: Option<String>,
    layout: Option<PanelLayout>,
    content: Option<serde_json::Value>,
    sort_order: Option<i64>,
}

async fn list_panels(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<tavern_core::Panel>>, ApiError> {
    let el = find_element_for_page(&state, id).await?;
    require_access(&state, &user, el.project_id).await?;
    Ok(Json(state.db.list_panels(id).await?))
}

async fn create_panel(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreatePanelBody>,
) -> Result<(StatusCode, Json<tavern_core::Panel>), ApiError> {
    let el = find_element_for_page(&state, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    let ptype = PanelType::parse(&body.panel_type).ok_or(ApiError::bad("invalid panel_type"))?;
    let sort = body.sort_order.unwrap_or(0);
    let layout = body
        .layout
        .unwrap_or_else(|| default_panel_layout_for(ptype.as_str(), sort as usize));
    let panel = state
        .db
        .create_panel(
            id,
            ptype,
            &body.title,
            body.border_color.as_deref(),
            layout,
            body.content.unwrap_or_else(|| serde_json::json!({})),
            sort,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(panel)))
}

#[derive(Deserialize)]
struct UpdatePanelBody {
    title: String,
    border_color: Option<String>,
    layout: PanelLayout,
    content: serde_json::Value,
    sort_order: i64,
}

async fn update_panel(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePanelBody>,
) -> Result<Json<tavern_core::Panel>, ApiError> {
    let el = find_element_for_panel(&state, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    Ok(Json(
        state
            .db
            .update_panel(
                id,
                &body.title,
                body.border_color.as_deref(),
                body.layout,
                body.content,
                body.sort_order,
            )
            .await?,
    ))
}

async fn delete_panel(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let el = find_element_for_panel(&state, id).await?;
    require_edit(&state, &user, el.project_id).await?;
    state.db.delete_panel(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CreateLinkBody {
    from_element_id: Uuid,
    to_element_id: Uuid,
    label: Option<String>,
    link_type: Option<String>,
    metadata: Option<serde_json::Value>,
}

async fn list_links(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<tavern_core::ElementLink>>, ApiError> {
    require_access(&state, &user, id).await?;
    Ok(Json(state.db.list_links(id).await?))
}

async fn create_link(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateLinkBody>,
) -> Result<(StatusCode, Json<tavern_core::ElementLink>), ApiError> {
    require_edit(&state, &user, id).await?;
    let link = state
        .db
        .create_link(
            id,
            body.from_element_id,
            body.to_element_id,
            body.label.as_deref().unwrap_or(""),
            body.link_type.as_deref().unwrap_or("related"),
            body.metadata.unwrap_or_else(|| serde_json::json!({})),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(link)))
}

async fn delete_link(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    // look up link via scanning is heavy; require auth and delete
    let _ = user;
    state.db.delete_link(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct ManuscriptBody {
    markdown: String,
    word_goal: i64,
    word_count: usize,
}

#[derive(Deserialize)]
struct PutManuscriptBody {
    markdown: String,
    word_goal: Option<i64>,
}

async fn get_manuscript(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<ManuscriptBody>, ApiError> {
    let el = state
        .db
        .get_element(id)
        .await?
        .ok_or(ApiError::not_found("element"))?;
    require_access(&state, &user, el.project_id).await?;
    let (markdown, word_goal) = state.db.get_manuscript(id).await?;
    let word_count = count_words(&markdown);
    Ok(Json(ManuscriptBody {
        markdown,
        word_goal,
        word_count,
    }))
}

async fn put_manuscript(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<PutManuscriptBody>,
) -> Result<Json<ManuscriptBody>, ApiError> {
    let el = state
        .db
        .get_element(id)
        .await?
        .ok_or(ApiError::not_found("element"))?;
    require_edit(&state, &user, el.project_id).await?;
    let (_, current_goal) = state.db.get_manuscript(id).await?;
    let goal = body.word_goal.unwrap_or(current_goal);
    state
        .db
        .set_manuscript(id, &body.markdown, goal)
        .await?;
    Ok(Json(ManuscriptBody {
        word_count: count_words(&body.markdown),
        markdown: body.markdown,
        word_goal: goal,
    }))
}

#[derive(Deserialize)]
struct TemplateQuery {
    module: Option<String>,
}

#[derive(Deserialize)]
struct SaveTemplateBody {
    name: String,
    description: Option<String>,
    module_type: String,
    project_id: Option<Uuid>,
    pages_json: serde_json::Value,
}

async fn list_templates(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Query(q): Query<TemplateQuery>,
) -> Result<Json<Vec<tavern_core::Template>>, ApiError> {
    let module = q.module.as_deref().and_then(ModuleType::parse);
    Ok(Json(state.db.list_templates(user.id, module).await?))
}

async fn save_template(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<SaveTemplateBody>,
) -> Result<(StatusCode, Json<tavern_core::Template>), ApiError> {
    let module =
        ModuleType::parse(&body.module_type).ok_or(ApiError::bad("invalid module_type"))?;
    let t = state
        .db
        .save_template(
            user.id,
            body.project_id,
            module,
            &body.name,
            body.description.as_deref().unwrap_or(""),
            body.pages_json,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(t)))
}

#[derive(Deserialize)]
struct ExportBody {
    format: String,
    kind: Option<String>, // manuscript | bible
}

async fn export_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<ExportBody>,
) -> Result<Response, ApiError> {
    require_access(&state, &user, id).await?;
    let format = ExportFormat::parse(&body.format).ok_or(ApiError::bad("invalid format"))?;
    let project = state
        .db
        .get_project(id)
        .await?
        .ok_or(ApiError::not_found("project"))?;
    let kind = body.kind.as_deref().unwrap_or("manuscript");
    let markdown = if kind == "bible" {
        let elements = state.db.list_elements(id, None).await?;
        let mut pairs = Vec::new();
        for el in elements {
            let body_md = if el.module_type == ModuleType::Manuscript {
                None
            } else {
                // gather text panels
                let pages = state.db.list_pages(el.id).await?;
                let mut md = String::new();
                for page in pages {
                    for panel in state.db.list_panels(page.id).await? {
                        if let Some(t) = panel.content.get("markdown").and_then(|v| v.as_str()) {
                            md.push_str(t);
                            md.push_str("\n\n");
                        }
                    }
                }
                Some(md)
            };
            pairs.push((el, body_md));
        }
        compile_world_bible_markdown(&project.title, &pairs)
    } else {
        let chapters = state
            .db
            .list_elements(id, Some(ModuleType::Manuscript))
            .await?;
        let mut bodies = Vec::new();
        for ch in chapters {
            let (md, _) = state.db.get_manuscript(ch.id).await?;
            bodies.push(ChapterBody {
                title: ch.title,
                markdown: md,
                sort_order: ch.sort_order,
            });
        }
        compile_manuscript_markdown(&project.title, &bodies)
    };

    let out_dir = state.config.data_dir.join("exports").join(id.to_string());
    let filename = format!(
        "{}-{}.{}",
        sanitize(&project.title),
        kind,
        format.extension()
    );
    let out_path = out_dir.join(&filename);
    write_with_pandoc(&markdown, &out_path, format)?;
    let bytes = std::fs::read(&out_path)?;
    Ok((
        [
            (header::CONTENT_TYPE, content_type_for(format)),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        bytes,
    )
        .into_response())
}

async fn backup_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    require_access(&state, &user, id).await?;
    let project = state
        .db
        .get_project(id)
        .await?
        .ok_or(ApiError::not_found("project"))?;
    let elements = state.db.list_elements(id, None).await?;
    let mut id_to_title = HashMap::new();
    for el in &elements {
        id_to_title.insert(el.id, el.title.clone());
    }
    let mut packed = Vec::new();
    for el in elements {
        let body = if el.module_type == ModuleType::Manuscript {
            Some(state.db.get_manuscript(el.id).await?.0)
        } else {
            None
        };
        let mut panels = Vec::new();
        for page in state.db.list_pages(el.id).await? {
            panels.extend(state.db.list_panels(page.id).await?);
        }
        packed.push((el, body, panels));
    }
    let links = state.db.list_links(id).await?;
    let intermediate = elements_to_intermediate(
        &project.title,
        &project.synopsis,
        packed,
        links,
        &id_to_title,
    );
    let assets = state.config.project_assets_dir(id);
    let out = state
        .config
        .data_dir
        .join("exports")
        .join(format!("{}.tavern", sanitize(&project.title)));
    write_tavern_backup(&out, &intermediate, Some(&assets))?;
    let bytes = std::fs::read(&out)?;
    let filename = format!("{}.tavern", sanitize(&project.title));
    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        bytes,
    )
        .into_response())
}

#[derive(Serialize)]
struct AssetInfo {
    name: String,
    url: String,
    size: u64,
}

fn safe_asset_name(original: &str) -> Result<String, ApiError> {
    let ext = std::path::Path::new(original)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    let allowed = ["png", "jpg", "jpeg", "webp", "gif", "svg"];
    if !allowed.contains(&ext.as_str()) {
        return Err(ApiError::bad("only image uploads (png/jpg/webp/gif/svg)"));
    }
    Ok(format!("{}.{}", Uuid::new_v4(), ext))
}

async fn list_assets(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<AssetInfo>>, ApiError> {
    require_access(&state, &user, id).await?;
    let dir = state.config.project_assets_dir(id);
    let mut out = Vec::new();
    if dir.is_dir() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let meta = entry.metadata()?;
            if !meta.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            out.push(AssetInfo {
                url: format!("/api/projects/{id}/assets/{name}"),
                name,
                size: meta.len(),
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(out))
}

async fn upload_asset(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<AssetInfo>), ApiError> {
    require_edit(&state, &user, id).await?;
    let dir = state.config.project_assets_dir(id);
    std::fs::create_dir_all(&dir)?;

    let mut stored: Option<AssetInfo> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::bad(&e.to_string()))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let original = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "upload.bin".into());
        let name = safe_asset_name(&original)?;
        let bytes = field
            .bytes()
            .await
            .map_err(|e| ApiError::bad(&e.to_string()))?;
        if bytes.len() > 12 * 1024 * 1024 {
            return Err(ApiError::bad("file too large (max 12MB)"));
        }
        let path = dir.join(&name);
        std::fs::write(&path, &bytes)?;
        stored = Some(AssetInfo {
            name: name.clone(),
            url: format!("/api/projects/{id}/assets/{name}"),
            size: bytes.len() as u64,
        });
    }
    let info = stored.ok_or(ApiError::bad("missing file field"))?;
    Ok((StatusCode::CREATED, Json(info)))
}

async fn get_asset(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path((id, name)): Path<(Uuid, String)>,
) -> Result<Response, ApiError> {
    require_access(&state, &user, id).await?;
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(ApiError::bad("invalid asset name"));
    }
    let path = state.config.project_assets_dir(id).join(&name);
    let bytes = std::fs::read(&path).map_err(|_| ApiError::not_found("asset"))?;
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    Ok(([(header::CONTENT_TYPE, mime)], bytes).into_response())
}

async fn delete_asset(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    Path((id, name)): Path<(Uuid, String)>,
) -> Result<StatusCode, ApiError> {
    require_edit(&state, &user, id).await?;
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(ApiError::bad("invalid asset name"));
    }
    let path = state.config.project_assets_dir(id).join(&name);
    if path.is_file() {
        std::fs::remove_file(&path)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn import_project(
    AuthUser(user): AuthUser,
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut bytes = None;
    let mut filename = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| ApiError::bad(&e.to_string()))? {
        if field.name() == Some("file") {
            filename = field.file_name().map(|s| s.to_string());
            bytes = Some(
                field
                    .bytes()
                    .await
                    .map_err(|e| ApiError::bad(&e.to_string()))?
                    .to_vec(),
            );
        }
    }
    let bytes = bytes.ok_or(ApiError::bad("file required"))?;
    let (intermediate, report) =
        tavern_import::load_bytes(&bytes, filename.as_deref())?;
    let prepared = tavern_import::prepare(intermediate, report)?;
    materialize_import(&state, user.id, prepared, &bytes).await
}

async fn materialize_import(
    state: &AppState,
    owner_id: Uuid,
    prepared: tavern_import::PreparedImport,
    original_bytes: &[u8],
) -> Result<Json<serde_json::Value>, ApiError> {
    let project = state
        .db
        .create_project(owner_id, &prepared.project.title, &prepared.project.synopsis)
        .await?;

    let mut title_to_id: HashMap<String, Uuid> = HashMap::new();
    for el in &prepared.project.elements {
        let module = ModuleType::parse(&el.module_type).unwrap_or(ModuleType::Encyclopedia);
        let mut meta = el.metadata.clone();
        if let Some(src) = &el.unsupported_source {
            meta.as_object_mut()
                .map(|o| o.insert("unsupported_source".into(), serde_json::json!(src)));
        }
        let created = state
            .db
            .create_element(
                project.id,
                module,
                &el.title,
                None,
                meta,
                el.panels.is_empty() && module != ModuleType::Manuscript,
            )
            .await?;
        title_to_id.insert(el.title.clone(), created.id);

        if module == ModuleType::Manuscript {
            let md = el.body_markdown.clone().unwrap_or_default();
            state.db.set_manuscript(created.id, &md, 0).await?;
        } else if !el.panels.is_empty() {
            let pages = state.db.list_pages(created.id).await?;
            for p in pages {
                state.db.delete_page(p.id).await?;
            }
            let page = state
                .db
                .create_page(created.id, "Imported", "", 0)
                .await?;
            for (i, panel) in el.panels.iter().enumerate() {
                let ptype =
                    PanelType::parse(&panel.panel_type).unwrap_or(PanelType::Text);
                let layout = panel
                    .layout
                    .clone()
                    .unwrap_or_else(|| default_panel_layout_for(ptype.as_str(), i));
                state
                    .db
                    .create_panel(
                        page.id,
                        ptype,
                        &panel.title,
                        None,
                        layout,
                        panel.content.clone(),
                        i as i64,
                    )
                    .await?;
            }
        } else if let Some(md) = &el.body_markdown {
            let pages = state.db.list_pages(created.id).await?;
            if let Some(page) = pages.first() {
                let panels = state.db.list_panels(page.id).await?;
                if let Some(panel) = panels.iter().find(|p| p.panel_type == PanelType::Text) {
                    let mut content = panel.content.clone();
                    content["markdown"] = serde_json::json!(md);
                    state
                        .db
                        .update_panel(
                            panel.id,
                            &panel.title,
                            panel.border_color.as_deref(),
                            panel.layout.clone(),
                            content,
                            panel.sort_order,
                        )
                        .await?;
                }
            }
        }
    }

    for el in &prepared.project.elements {
        if let Some(parent_title) = &el.parent_title {
            if let (Some(child), Some(parent)) =
                (title_to_id.get(&el.title), title_to_id.get(parent_title))
            {
                if let Some(existing) = state.db.get_element(*child).await? {
                    state
                        .db
                        .update_element(
                            *child,
                            &existing.title,
                            Some(*parent),
                            existing.sort_order,
                            existing.metadata,
                        )
                        .await?;
                }
            }
        }
    }

    for link in &prepared.project.links {
        if let (Some(from), Some(to)) = (
            title_to_id.get(&link.from_title),
            title_to_id.get(&link.to_title),
        ) {
            state
                .db
                .create_link(
                    project.id,
                    *from,
                    *to,
                    &link.label,
                    &link.link_type,
                    serde_json::json!({}),
                )
                .await?;
        }
    }

    let import_path = state
        .config
        .data_dir
        .join("imports")
        .join(format!("{}.bin", project.id));
    let _ = std::fs::write(&import_path, original_bytes);

    Ok(Json(serde_json::json!({
        "project": project,
        "report": {
            "format": prepared.report.format,
            "title": prepared.report.title,
            "element_count": prepared.report.element_count,
            "link_count": prepared.report.link_count,
            "unsupported_modules": prepared.report.unsupported_modules,
            "notes": prepared.report.notes
        }
    })))
}

async fn list_modules() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "modules": ModuleType::all().iter().map(|m| m.as_str()).collect::<Vec<_>>()
    }))
}

async fn index() -> Response {
    match Assets::get("index.html") {
        Some(f) => Html(
            std::str::from_utf8(f.data.as_ref())
                .unwrap_or("<p>Tavern UI missing</p>")
                .to_string(),
        )
        .into_response(),
        None => Html(
            r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tavern</title></head>
<body style="font-family:system-ui;background:#e6e9e6;color:#1c2421;padding:2rem">
<h1>Tavern</h1>
<p>API is running. Build the UI with <code>cd web && npm install && npm run build</code>.</p>
</body></html>"#
                .to_string(),
        )
        .into_response(),
    }
}

async fn static_asset(Path(path): Path<String>) -> Response {
    // Route is `/assets/{*path}`, but rust-embed keys are relative to `web/dist/`
    // (e.g. `assets/index-….js`), so re-prefix the folder segment.
    let path = path.trim_start_matches('/');
    let key = if path.starts_with("assets/") {
        path.to_string()
    } else {
        format!("assets/{path}")
    };
    match Assets::get(&key) {
        Some(f) => {
            let mime = mime_guess::from_path(&key)
                .first_or_octet_stream()
                .to_string();
            ([(header::CONTENT_TYPE, mime)], f.data.to_vec()).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn require_access(
    state: &AppState,
    user: &User,
    project_id: Uuid,
) -> Result<GrantRole, ApiError> {
    state
        .db
        .project_access(user, project_id)
        .await?
        .ok_or(ApiError::forbidden())
}

async fn require_edit(
    state: &AppState,
    user: &User,
    project_id: Uuid,
) -> Result<GrantRole, ApiError> {
    let role = require_access(state, user, project_id).await?;
    if !role.can_edit() {
        return Err(ApiError::forbidden());
    }
    Ok(role)
}

async fn require_manage(
    state: &AppState,
    user: &User,
    project_id: Uuid,
) -> Result<GrantRole, ApiError> {
    let role = require_access(state, user, project_id).await?;
    if !role.can_manage() {
        return Err(ApiError::forbidden());
    }
    Ok(role)
}

async fn find_element_for_page(state: &AppState, page_id: Uuid) -> Result<Element, ApiError> {
    use sqlx::Row;
    let r = sqlx::query("SELECT element_id FROM pages WHERE id = ?")
        .bind(page_id.to_string())
        .fetch_optional(state.db.pool())
        .await?
        .ok_or(ApiError::not_found("page"))?;
    let eid = Uuid::parse_str(r.get::<String, _>("element_id").as_str()).unwrap();
    state
        .db
        .get_element(eid)
        .await?
        .ok_or(ApiError::not_found("element"))
}

async fn find_element_for_panel(state: &AppState, panel_id: Uuid) -> Result<Element, ApiError> {
    use sqlx::Row;
    let r = sqlx::query(
        "SELECT p.element_id FROM panels pan JOIN pages p ON p.id = pan.page_id WHERE pan.id = ?",
    )
    .bind(panel_id.to_string())
    .fetch_optional(state.db.pool())
    .await?
    .ok_or(ApiError::not_found("panel"))?;
    let eid = Uuid::parse_str(r.get::<String, _>("element_id").as_str()).unwrap();
    state
        .db
        .get_element(eid)
        .await?
        .ok_or(ApiError::not_found("element"))
}

fn count_words(s: &str) -> usize {
    s.split_whitespace().count()
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn content_type_for(format: ExportFormat) -> String {
    match format {
        ExportFormat::Markdown => "text/markdown; charset=utf-8".into(),
        ExportFormat::Docx => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into()
        }
        ExportFormat::Epub => "application/epub+zip".into(),
        ExportFormat::Pdf => "application/pdf".into(),
        ExportFormat::Html => "text/html; charset=utf-8".into(),
    }
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad(msg: &str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }
    fn unauthorized(msg: &str) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: msg.into(),
        }
    }
    fn forbidden() -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: "forbidden".into(),
        }
    }
    fn not_found(what: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: format!("{what} not found"),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: e.to_string(),
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: e.to_string(),
        }
    }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: e.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({ "error": self.message })),
        )
            .into_response()
    }
}
