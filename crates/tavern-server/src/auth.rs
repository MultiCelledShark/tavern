use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum_extra::extract::cookie::CookieJar;
use std::sync::Arc;
use tavern_core::User;

use crate::state::AppState;

pub struct AuthUser(pub User);

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        let token = jar
            .get("tavern_session")
            .map(|c| c.value().to_string())
            .or_else(|| {
                parts
                    .headers
                    .get("authorization")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.strip_prefix("Bearer "))
                    .map(|s| s.to_string())
            })
            .ok_or(StatusCode::UNAUTHORIZED)?;

        let user = state
            .db
            .user_for_session(&token)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::UNAUTHORIZED)?;
        Ok(AuthUser(user))
    }
}

pub struct AdminUser(pub User);

impl FromRequestParts<Arc<AppState>> for AdminUser {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let AuthUser(user) = AuthUser::from_request_parts(parts, state).await?;
        if !user.is_admin {
            return Err(StatusCode::FORBIDDEN);
        }
        Ok(AdminUser(user))
    }
}
