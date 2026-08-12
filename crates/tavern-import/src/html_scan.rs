//! Tiny HTML scrapers used by Campfire import — no regex crate.

/// ASCII case-insensitive find; returns byte offset into `hay`.
pub fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    let n: Vec<u8> = needle.bytes().map(|b| b.to_ascii_lowercase()).collect();
    let h = hay.as_bytes();
    if n.len() > h.len() {
        return None;
    }
    for i in 0..=h.len() - n.len() {
        if h[i..i + n.len()]
            .iter()
            .zip(n.iter())
            .all(|(a, b)| a.to_ascii_lowercase() == *b)
        {
            return Some(i);
        }
    }
    None
}

/// Content after `open` until the next `close` (exclusive).
pub fn between<'a>(hay: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = hay.find(open)? + open.len();
    let end = start + hay[start..].find(close)?;
    Some(&hay[start..end])
}

/// Find `marker`, skip to the next `>`, then take until `close`.
pub fn after_marker_until<'a>(hay: &'a str, marker: &str, close: &str) -> Option<&'a str> {
    let m = hay.find(marker)?;
    let after_marker = m + marker.len();
    let gt = after_marker + hay[after_marker..].find('>')?;
    let start = gt + 1;
    let end = start + hay[start..].find(close)?;
    Some(&hay[start..end])
}

/// All non-overlapping `after_marker_until` matches, scanning forward.
pub fn after_marker_until_all<'a>(hay: &'a str, marker: &str, close: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(rel) = hay[pos..].find(marker) {
        let abs = pos + rel;
        let after_marker = abs + marker.len();
        let Some(gt_rel) = hay[after_marker..].find('>') else {
            break;
        };
        let start = after_marker + gt_rel + 1;
        let Some(end_rel) = hay[start..].find(close) else {
            break;
        };
        let end = start + end_rel;
        out.push(&hay[start..end]);
        pos = end + close.len();
    }
    out
}

pub fn class_attr(tag: &str) -> Option<&str> {
    let marker = "class=\"";
    let start = tag.find(marker)? + marker.len();
    let end = start + tag[start..].find('"')?;
    Some(&tag[start..end])
}

/// Nest-aware `<section …needle…>…</section>` extraction.
pub fn extract_sections<'a>(html: &'a str, needle: &str) -> Vec<(&'a str, &'a str)> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(open_rel) = find_ci(&html[pos..], "<section") {
        let open_abs = pos + open_rel;
        let Some(gt_rel) = html[open_abs..].find('>') else {
            break;
        };
        let tag_end = open_abs + gt_rel + 1;
        let tag = &html[open_abs..tag_end];
        if !tag.contains(needle) {
            pos = tag_end;
            continue;
        }
        let mut depth = 1usize;
        let mut cursor = tag_end;
        let content_start = tag_end;
        while depth > 0 && cursor < html.len() {
            let next_open = find_ci(&html[cursor..], "<section").map(|i| cursor + i);
            let next_close = find_ci(&html[cursor..], "</section>").map(|i| cursor + i);
            match (next_open, next_close) {
                (_, None) => {
                    cursor = html.len();
                    break;
                }
                (Some(o), Some(c)) if o < c => {
                    // advance past this open tag
                    if let Some(gt) = html[o..].find('>') {
                        depth += 1;
                        cursor = o + gt + 1;
                    } else {
                        cursor = html.len();
                        break;
                    }
                }
                (_, Some(c)) => {
                    depth -= 1;
                    if depth == 0 {
                        out.push((tag, &html[content_start..c]));
                        cursor = c + "</section>".len();
                        break;
                    }
                    cursor = c + "</section>".len();
                }
            }
        }
        pos = cursor;
    }
    out
}

pub fn remove_blocks_ci(mut s: String, open: &str, close: &str) -> String {
    while let Some(start) = find_ci(&s, open) {
        let Some(rel) = find_ci(&s[start..], close) else {
            break;
        };
        let end = start + rel + close.len();
        s.replace_range(start..end, "");
    }
    s
}

pub fn replace_ci(mut s: String, from: &str, to: &str) -> String {
    while let Some(i) = find_ci(&s, from) {
        s.replace_range(i..i + from.len(), to);
    }
    s
}

/// True when `open` (`"<tag"`) at `start` is a real tag, not a longer name (`<i` vs `<img`).
fn is_tag_open_at(s: &str, start: usize, open_len: usize) -> bool {
    let after = start + open_len;
    if after >= s.len() {
        return false;
    }
    let c = s.as_bytes()[after];
    c == b'>' || c == b'/' || c.is_ascii_whitespace()
}

/// Replace `<tag…>inner</tag>` with `prefix + inner + suffix` (non-greedy, case-insensitive tag).
pub fn rewrite_wrapped_ci(mut s: String, tag: &str, prefix: &str, suffix: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut guard = 0;
    let mut search = 0;
    while guard < 10_000 {
        guard += 1;
        let Some(rel) = find_ci(&s[search..], &open) else {
            break;
        };
        let start = search + rel;
        if !is_tag_open_at(&s, start, open.len()) {
            search = start + open.len();
            continue;
        }
        let Some(gt_rel) = s[start..].find('>') else {
            break;
        };
        let inner_start = start + gt_rel + 1;
        let Some(close_rel) = find_ci(&s[inner_start..], &close) else {
            break;
        };
        let inner_end = inner_start + close_rel;
        let end = inner_end + close.len();
        let inner = s[inner_start..inner_end].to_string();
        let replacement = format!("{prefix}{inner}{suffix}");
        s.replace_range(start..end, &replacement);
        search = start + replacement.len();
    }
    s
}

/// Replace every opening `<tag…>` (ci, name-bounded) with `repl`.
pub fn replace_open_tag_ci(mut s: String, tag: &str, repl: &str) -> String {
    let open = format!("<{tag}");
    let mut search = 0;
    let mut guard = 0;
    while guard < 10_000 {
        guard += 1;
        let Some(rel) = find_ci(&s[search..], &open) else {
            break;
        };
        let start = search + rel;
        if !is_tag_open_at(&s, start, open.len()) {
            search = start + open.len();
            continue;
        }
        let Some(gt_rel) = s[start..].find('>') else {
            break;
        };
        let end = start + gt_rel + 1;
        s.replace_range(start..end, repl);
        search = start + repl.len();
    }
    s
}

/// Remove every `<open_marker…>…</close>` occurrence (literal open marker + close tag).
pub fn remove_marked_element(mut s: String, open_marker: &str, close: &str) -> String {
    while let Some(start) = s.find(open_marker) {
        let Some(rel) = s[start..].find(close) else {
            break;
        };
        let end = start + rel + close.len();
        s.replace_range(start..end, "");
    }
    s
}

pub fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

pub fn html_unescape(s: &str) -> String {
    let out = s
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ");
    let chars: Vec<char> = out.chars().collect();
    let mut out2 = String::with_capacity(out.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '&' && i + 2 < chars.len() && chars[i + 1] == '#' {
            let mut j = i + 2;
            let mut num: u32 = 0;
            let mut ok = false;
            while j < chars.len() && chars[j].is_ascii_digit() {
                ok = true;
                num = num
                    .saturating_mul(10)
                    .saturating_add(chars[j].to_digit(10).unwrap_or(0));
                j += 1;
            }
            if ok && j < chars.len() && chars[j] == ';' {
                if let Some(c) = char::from_u32(num) {
                    out2.push(c);
                    i = j + 1;
                    continue;
                }
            }
        }
        out2.push(chars[i]);
        i += 1;
    }
    out2
}

pub fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            prev_space = false;
            out.push(ch);
        }
    }
    out.trim().to_string()
}

pub fn attr_quoted<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let marker = format!("{name}=\"");
    let start = tag.find(&marker)? + marker.len();
    let end = start + tag[start..].find('"')?;
    Some(&tag[start..end])
}
