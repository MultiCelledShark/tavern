use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use tavern_core::Config;

/// SMTP client built once at boot. Sends happen on a spawned task so login/signup
/// never wait on the mail server.
#[derive(Clone)]
pub struct Mailer {
    transport: Option<AsyncSmtpTransport<Tokio1Executor>>,
    from: Mailbox,
    public_url: String,
}

impl Mailer {
    pub fn from_config(cfg: &Config) -> Self {
        let from = cfg
            .smtp_from
            .parse::<Mailbox>()
            .unwrap_or_else(|_| "tavern@localhost".parse().expect("fallback from"));
        let transport = match cfg.smtp_host.as_deref() {
            Some(host) => match build_transport(host, cfg) {
                Ok(t) => {
                    tracing::info!(host, port = cfg.smtp_port, "SMTP ready");
                    Some(t)
                }
                Err(e) => {
                    tracing::warn!(error = %e, "SMTP not ready; verification links will be logged");
                    None
                }
            },
            None => {
                tracing::info!("TAVERN_SMTP_HOST unset; verification links will be logged");
                None
            }
        };
        Self {
            transport,
            from,
            public_url: cfg.public_url.clone(),
        }
    }

    pub fn spawn_send(&self, to: String, subject: String, body: String) {
        let transport = self.transport.clone();
        let from = self.from.clone();
        tokio::spawn(async move {
            if let Some(mailer) = transport {
                let Ok(to_box) = to.parse::<Mailbox>() else {
                    tracing::warn!(to, "skipping mail: invalid recipient");
                    return;
                };
                let msg = Message::builder()
                    .from(from)
                    .to(to_box)
                    .subject(subject)
                    .body(body);
                match msg {
                    Ok(msg) => {
                        if let Err(e) = mailer.send(msg).await {
                            tracing::error!(error = %e, "SMTP send failed");
                        }
                    }
                    Err(e) => tracing::error!(error = %e, "failed to build email"),
                }
            } else {
                tracing::info!(to, subject, "email (no SMTP)\n{body}");
            }
        });
    }

    pub fn send_verify(&self, to: &str, token: &str) {
        // Fragment keeps the secret out of reverse-proxy access logs.
        let url = format!("{}/verify#{}", self.public_url, token);
        self.spawn_send(
            to.to_string(),
            "Verify your Tavern account".into(),
            format!(
                "Welcome to Tavern.\n\nConfirm this address:\n{url}\n\nThis link expires in 48 hours.\n"
            ),
        );
    }

    pub fn send_reset(&self, to: &str, token: &str) {
        let url = format!("{}/reset#{}", self.public_url, token);
        self.spawn_send(
            to.to_string(),
            "Reset your Tavern password".into(),
            format!("Reset your password:\n{url}\n\nThis link expires in 2 hours.\n"),
        );
    }

    pub fn send_already_registered(&self, to: &str) {
        let login = format!("{}/login", self.public_url);
        let forgot = format!("{}/forgot", self.public_url);
        self.spawn_send(
            to.to_string(),
            "Your Tavern account".into(),
            format!(
                "Someone tried to sign up with this address.\n\nIf that was you, sign in:\n{login}\n\nOr reset your password:\n{forgot}\n\nIf it wasn't you, ignore this.\n"
            ),
        );
    }
}

fn build_transport(
    host: &str,
    cfg: &Config,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, lettre::transport::smtp::Error> {
    let builder = match cfg.smtp_security.as_str() {
        "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(host)?,
        "off" | "none" | "plain" => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host),
        _ => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?,
    };
    let mut builder = builder.port(cfg.smtp_port);
    if let (Some(user), Some(pass)) = (&cfg.smtp_user, &cfg.smtp_pass) {
        if !user.is_empty() {
            builder = builder.credentials(Credentials::new(user.clone(), pass.clone()));
        }
    }
    Ok(builder.build())
}
