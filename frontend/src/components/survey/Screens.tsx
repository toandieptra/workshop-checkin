"use client";

import { useState } from "react";
import QRCode from "react-qr-code";
import { Alert, Bang, Check, Gift, Info, Lock, Mail, Phone } from "./icons";
import { ddmm, hhmm, telHref, validName, validPhone, type GiftResult, type PublicSurvey, type Submission, type SurveyItem } from "@/lib/survey-public";

export const MASCOT = "/survey/lermao-mascot.png";
const HERO = "/survey/hero-default.jpg";

function itemThumb(item: SurveyItem | undefined) {
  const img = item?.images[0];
  return img ? { src: img.thumb || img.src, pos: `center ${img.focus_y}%` } : null;
}

export function ContactCard({ hotline, email }: { hotline: string; email: string }) {
  if (!hotline && !email) return null;
  return (
    <div className="lm-contact">
      <span className="lm-eyebrow">Cần hỗ trợ?</span>
      {hotline && (
        <a href={telHref(hotline)} style={{ fontSize: 16, fontWeight: 700, color: "#000", textDecoration: "none" }}><Phone />Hotline {hotline}</a>
      )}
      {email && (
        <a href={`mailto:${email}`} style={{ fontSize: 15, fontWeight: 600, wordBreak: "break-all" }}><Mail />{email}</a>
      )}
    </div>
  );
}

export function InvalidScreen({ path, hotline }: { path: string; hotline?: string }) {
  return (
    <main className="lm-state lm-narrow">
      <img src={MASCOT} alt="Gấu LerMao" width={140} height={140} style={{ objectFit: "contain" }} />
      <span className="lm-state-pill" style={{ background: "var(--danger-tint)", color: "var(--danger)" }}>Không tìm thấy workshop</span>
      <h1 className="lm-h1">Gấu LerMao chưa tìm thấy phiếu này</h1>
      <p style={{ margin: 0, fontSize: 15, lineHeight: "23px" }}>Đường dẫn có thể bị thiếu ký tự hoặc mã QR đã cũ. Vui lòng quét lại mã QR tại bàn workshop.</p>
      <code style={{ display: "block", width: "100%", padding: "10px 12px", borderRadius: 8, background: "#f5f5f5", fontSize: 13, color: "#4d4d4d", wordBreak: "break-all" }}>…{path}</code>
      <div className="lm-boxed" style={{ border: "1px solid var(--border)" }}>
        <b>Cách khắc phục nhanh</b>
        <span>1. Quét lại QR bằng camera điện thoại.</span>
        <span>2. Hỏi nhân viên LerMao tại quầy để lấy link mới.</span>
      </div>
      {hotline && <a href={telHref(hotline)} className="lm-btn lm-btn-secondary lm-btn-block">Gọi hotline {hotline}</a>}
    </main>
  );
}

export function LoadingScreen() {
  return (
    <main className="lm-state lm-narrow" aria-busy="true">
      <img src={MASCOT} alt="" width={96} height={96} style={{ objectFit: "contain", opacity: 0.6 }} />
      <span className="lm-sr">Đang tải khảo sát…</span>
      <div className="lm-skeleton" style={{ width: "70%", height: 20 }} />
      <div className="lm-skeleton" style={{ width: "50%", height: 14 }} />
    </main>
  );
}

export function ClosedScreen({ data, likedCount, onViewLiked, notOpen }: {
  data: PublicSurvey; likedCount: number; onViewLiked?: () => void; notOpen?: boolean;
}) {
  const s = data.survey;
  const closedAt = data.closed_at || data.closes_at;
  return (
    <main className="lm-state lm-narrow">
      <img src={MASCOT} alt="Gấu LerMao" width={140} height={140} style={{ objectFit: "contain" }} />
      <span className="lm-state-pill"><Lock />{notOpen ? "Chưa mở nhận phiếu" : "Đã đóng nhận phiếu"}</span>
      <h1 className="lm-h1">{notOpen ? "Khảo sát chưa bắt đầu" : "Workshop đã kết thúc"}</h1>
      {notOpen ? (
        <p style={{ margin: 0, fontSize: 15, lineHeight: "23px" }}>
          <b>{s.title}</b> sẽ mở nhận góp ý{data.opens_at ? ` lúc ${hhmm(data.opens_at)} ngày ${ddmm(data.opens_at)}` : " khi workshop bắt đầu"}. Hẹn gặp anh/chị!
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 15, lineHeight: "23px" }}>
          <b>{s.title}</b> đã dừng nhận góp ý{closedAt ? ` lúc ${hhmm(closedAt)} ngày ${ddmm(closedAt)}` : ""}. Cảm ơn anh/chị đã ghé!
        </p>
      )}
      {!notOpen && likedCount > 0 && (
        <div className="lm-boxed" style={{ background: "var(--tint-demo)", lineHeight: "21px", gap: 8 }}>
          <b>Anh/chị có {likedCount} món đã thích chưa gửi</b>
          <span>Phiếu nháp không còn gửi được, nhưng team vẫn muốn nghe — gọi hotline hoặc gửi email bên dưới.</span>
          {onViewLiked && (
            <button type="button" onClick={onViewLiked} className="lm-btn-ghost" style={{ alignSelf: "flex-start", padding: 0 }}>Xem lại món đã thích (chỉ xem)</button>
          )}
        </div>
      )}
      {s.hotline && <a href={telHref(s.hotline)} className="lm-btn lm-btn-primary lm-btn-block">Gọi hotline {s.hotline}</a>}
      {s.email && <a href={`mailto:${s.email}`} style={{ minHeight: 44, display: "flex", alignItems: "center", fontSize: 14, fontWeight: 600 }}>{s.email}</a>}
    </main>
  );
}

export function IdentifyScreen({ data, busy, serverError, onStart }: {
  data: PublicSurvey; busy: boolean; serverError: string | null;
  onStart: (name: string, phone: string) => void;
}) {
  const s = data.survey;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tried, setTried] = useState(false);
  const [touched, setTouched] = useState<{ name?: boolean; phone?: boolean }>({});
  const showName = tried || touched.name;
  const showPhone = tried || touched.phone;
  const nameErr = showName && !validName(name)
    ? (name.trim() ? "Tên cần từ 2 đến 40 ký tự." : "Cho team biết tên hoặc biệt danh để xưng hô nhé.") : "";
  const phoneErr = showPhone && !validPhone(phone)
    ? (phone.trim() ? "Số điện thoại chưa đúng — kiểm tra lại 10 số, bắt đầu bằng 0." : "Nhập số điện thoại để team phản hồi sau workshop.") : "";
  const errorCount = (tried && !validName(name) ? 1 : 0) + (tried && !validPhone(phone) ? 1 : 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!validName(name)) { document.getElementById("lm-name")?.focus(); return; }
    if (!validPhone(phone)) { document.getElementById("lm-phone")?.focus(); return; }
    onStart(name.trim(), phone.trim());
  };
  const timeLabel = data.state === "open" && s.event_time ? `Đang diễn ra · ${s.event_time}` : data.state === "open" ? "Đang mở nhận phiếu" : "";

  return (
    <main className="lm-page lm-narrow">
      <div className="lm-hero">
        <img className="lm-hero-img" src={s.hero_image_url || HERO} alt="Các ly đồ uống LerMao" />
        <img className="lm-hero-logo" src={MASCOT} alt="LerMao" />
        {timeLabel && <span className="lm-live-pill"><span className="lm-live-dot" />{timeLabel}</span>}
      </div>
      <form className="lm-identify-body" onSubmit={submit} noValidate>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {s.brand_line && <span className="lm-eyebrow">{s.brand_line}</span>}
          <h1 className="lm-h1">{s.title}</h1>
          {s.tagline && <p className="lm-tagline">{s.tagline}</p>}
        </div>
        {errorCount > 0 ? (
          <div role="alert" className="lm-alert"><Alert /><span><b>Còn {errorCount} thông tin cần bổ sung</b> để team ghi nhận lựa chọn của anh/chị.</span></div>
        ) : s.greeting ? <p className="lm-greeting">{s.greeting}</p> : null}
        {serverError && <div role="alert" className="lm-alert"><Alert /><span>{serverError}</span></div>}
        <div className="lm-field">
          <label htmlFor="lm-name" className="lm-label">Tên / biệt danh <span className="lm-req">*</span></label>
          <input id="lm-name" className="lm-input" type="text" autoComplete="nickname" placeholder="VD: Minh Anh" value={name} maxLength={40}
            onChange={(e) => setName(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, name: tried || t.name }))}
            aria-invalid={nameErr ? "true" : "false"} aria-describedby={nameErr ? "lm-name-err" : undefined} />
          {nameErr && <span id="lm-name-err" role="alert" className="lm-field-error"><Bang />{nameErr}</span>}
        </div>
        <div className="lm-field">
          <label htmlFor="lm-phone" className="lm-label">Số điện thoại <span className="lm-req">*</span></label>
          <input id="lm-phone" className="lm-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="09xx xxx xxx" value={phone} maxLength={20}
            onChange={(e) => setPhone(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, phone: tried || t.phone }))}
            aria-invalid={phoneErr ? "true" : "false"} aria-describedby={["lm-phone-help", phoneErr ? "lm-phone-err" : ""].join(" ").trim()} />
          {phoneErr && <span id="lm-phone-err" role="alert" className="lm-field-error"><Bang />{phoneErr}</span>}
          {s.phone_helper && <div id="lm-phone-help" className="lm-helper"><Info /><span>{s.phone_helper}</span></div>}
        </div>
        <button type="submit" className="lm-btn lm-btn-primary" style={{ marginTop: 4 }} disabled={busy} aria-busy={busy}>
          {busy ? "Đang mở phiếu…" : "Bắt đầu trải nghiệm"}
        </button>
        <p className="lm-fineprint">Không cần tạo tài khoản · Lựa chọn được lưu tự động</p>
      </form>
    </main>
  );
}

export function ResumeScreen({ data, name, favorites, adjCount, savedAt, onContinue, onFinish, onReset }: {
  data: PublicSurvey; name: string; favorites: SurveyItem[]; adjCount: number; savedAt: string | null;
  onContinue: () => void; onFinish: () => void; onReset: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const shown = favorites.slice(0, 5);
  return (
    <main className="lm-resume">
      <div className="lm-narrow" style={{ display: "flex", flexDirection: "column", flex: "1 1 auto" }}>
        <div className="lm-resume-head">
          <img src={MASCOT} alt="Gấu LerMao" width={132} height={132} style={{ objectFit: "contain" }} />
          <span className="lm-eyebrow">{data.survey.title}</span>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: "36px", fontWeight: 800 }}>Chào lại {name}!</h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: "23px" }}>Mọi lựa chọn vẫn còn nguyên — tiếp tục thử món và chạm tim nhé.</p>
        </div>
        <div className="lm-card" style={{ margin: "24px 16px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b style={{ fontSize: 15 }}>Tiến độ của anh/chị</b>
            {savedAt && <span style={{ fontSize: 12, color: "var(--ink-secondary)" }}>Lưu lần cuối {hhmm(savedAt)}</span>}
          </div>
          {shown.length > 0 && (
            <div className="lm-thumbs">
              {shown.map((it) => {
                const t = itemThumb(it);
                const tint = data.groups.find((g) => g.key === it.group)?.tint || "#f5f5f5";
                return t ? <img key={it.key} className="lm-thumb52" src={t.src} alt="" style={{ objectPosition: t.pos, background: tint }} />
                  : <span key={it.key} className="lm-thumb52" style={{ background: tint }} />;
              })}
              {favorites.length > 5 && <span className="lm-thumb-more">+{favorites.length - 5}</span>}
            </div>
          )}
          <div className="lm-stats">
            <div style={{ background: "var(--tint-topping)" }}><b style={{ color: "var(--crimson)" }}>{favorites.length}</b>món đã thích</div>
            <div style={{ background: "var(--tint-trasua)" }}><b>{adjCount}</b>tính từ</div>
            <div style={{ background: "var(--surface)" }}><b>—</b>chưa gửi</div>
          </div>
        </div>
        <div style={{ padding: "20px 16px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" className="lm-btn lm-btn-primary" onClick={onContinue}>Tiếp tục thử món</button>
          <button type="button" className="lm-btn lm-btn-secondary" style={{ height: 48, fontSize: 15 }} onClick={onFinish}>Đi tới Hoàn tất &amp; gửi</button>
          {confirming ? (
            <div className="lm-boxed" role="alertdialog" aria-label="Xác nhận bắt đầu phiếu mới" style={{ background: "#fff", border: "1px solid var(--border)" }}>
              <b>Xoá phiếu nháp của {name} trên máy này?</b>
              <span style={{ color: "var(--ink-secondary)" }}>Các món đã thích và góp ý chưa gửi sẽ bị xoá.</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="lm-btn-soft" onClick={() => setConfirming(false)}>Giữ lại</button>
                <button type="button" className="lm-btn-outline-link" style={{ borderColor: "var(--danger)", color: "var(--danger)" }} onClick={onReset}>Xoá &amp; bắt đầu lại</button>
              </div>
            </div>
          ) : (
            <button type="button" className="lm-btn-ghost" style={{ alignSelf: "center", fontWeight: 600 }} onClick={() => setConfirming(true)}>
              Không phải {name}? Bắt đầu phiếu mới
            </button>
          )}
        </div>
        <p style={{ margin: "auto 16px 20px", paddingTop: 20, fontSize: 12, lineHeight: "18px", color: "var(--ink-secondary)", textAlign: "center" }}>
          Phiếu được lưu cho tới khi gửi. Mở lại đúng đường dẫn này trên điện thoại để tiếp tục.
        </p>
      </div>
    </main>
  );
}

function GiftStatusPill({ gift }: { gift: GiftResult }) {
  if (gift.status === "redeemed") return <span className="lm-gift-status" style={{ background: "var(--success-tint)" }}><Check />Đã nhận quà{gift.redeemed_at ? ` lúc ${hhmm(gift.redeemed_at)}` : ""}</span>;
  if (gift.status === "expired") return <span className="lm-gift-status" style={{ background: "var(--surface)" }}><Lock />Mã nhận quà đã hết hạn</span>;
  if (gift.status === "revoked") return <span className="lm-gift-status" style={{ background: "var(--danger-tint)", color: "var(--danger)" }}>Mã nhận quà đã bị thu hồi</span>;
  return null;
}

export function ThanksScreen({ data, name, phoneMasked, submission, localGift, reissuing, reissueError, onReissue, onCompanion }: {
  data: PublicSurvey; name: string; phoneMasked: string; submission: Submission;
  localGift: { qr: string; code: string } | null; reissuing: boolean; reissueError: string | null; onReissue: () => void;
  onCompanion: () => void;
}) {
  const s = data.survey;
  const gift = submission.gift;
  const qr = gift.qr || localGift?.qr;
  const code = gift.code || localGift?.code;
  const usable = gift.variant === "gift" && (gift.status === "issued" || !gift.status);
  return (
    <main className="lm-thanks">
      <div className="lm-narrow" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <img src={MASCOT} alt="Gấu LerMao" width={112} height={112} style={{ objectFit: "contain" }} />
        <h1 className="lm-script">Cảm ơn anh/chị!</h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: "24px" }}>{s.thank_you}</p>

        {gift.variant === "gift" && (
          <div role="region" aria-label="Phiếu nhận quà" className="lm-gift-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Gift />
              <b style={{ fontSize: 17, lineHeight: "23px" }}>{usable ? "Đưa mã này cho nhân viên để nhận quà" : "Phiếu nhận quà"}</b>
            </div>
            <GiftStatusPill gift={gift} />
            {usable && (
              <span style={{ fontSize: 13, lineHeight: "19px" }}>
                {gift.instructions || "Nhân viên tại quầy LerMao sẽ quét mã QR bên dưới. Mỗi phiếu nhận quà 1 lần."}
              </span>
            )}
            {usable && qr && (
              <div className="lm-qr" aria-label="Mã QR nhận quà">
                <QRCode value={qr} size={196} level="M" />
              </div>
            )}
            {usable && !qr && (
              <div className="lm-boxed" style={{ background: "var(--tint-trasua)", padding: 12 }}>
                <span>Thiết bị này chưa lưu mã QR (có thể do xoá dữ liệu trình duyệt).</span>
                <button type="button" className="lm-btn lm-btn-primary" style={{ height: 44, fontSize: 15 }} onClick={onReissue} disabled={reissuing}>
                  {reissuing ? "Đang tạo mã…" : "Hiển thị lại mã nhận quà"}
                </button>
                {reissueError && <span role="alert" style={{ color: "var(--danger)", fontWeight: 600 }}>{reissueError}</span>}
              </div>
            )}
            <div className="lm-gift-grid">
              <span>Quà tặng</span><b>{gift.gift_name}</b>
              <span>Khách</span><b>{name} · {phoneMasked}</b>
              <span>Đã thích / sao</span><b>{submission.favorite_count} món{submission.rating ? ` · ${submission.rating}/5 sao` : ""}</b>
              <span>Gửi lúc</span><b>{hhmm(submission.submitted_at)} · {ddmm(submission.submitted_at)} · {s.title}</b>
              {usable && code && (<><span style={{ alignSelf: "center" }}>Mã nhập tay</span><b className="lm-gift-code">{code}</b></>)}
            </div>
          </div>
        )}

        {gift.variant === "ineligible" && (
          <div role="region" aria-label="Thông tin quà tặng" className="lm-boxed" style={{ background: "#fff", border: "1px solid var(--border)", lineHeight: "21px" }}>
            <b style={{ display: "flex", gap: 8, alignItems: "center" }}><Info />Phiếu đã được ghi nhận</b>
            <span>
              {gift.reason === "expired"
                  ? "Chương trình quà tặng của workshop đã kết thúc."
                  : "Phiếu này chưa kèm quà tặng. Nếu cần hỗ trợ, vui lòng liên hệ nhân viên LerMao tại quầy."}
            </span>
          </div>
        )}

        {(submission.remaining ?? 0) > 0 && (
          <div className="lm-boxed" style={{ background: "#fff", border: "1px solid var(--border)", lineHeight: "21px" }}>
            <b>Còn {submission.remaining} phiếu cho khách đi cùng</b>
            <span>Số điện thoại này đã check-in {submission.quota} khách — mỗi người làm một phiếu và nhận một phần quà.</span>
            {usable ? (
              <span style={{ color: "var(--ink-secondary)" }}>Nhận quà cho phiếu này trước (mã QR ở trên sẽ không hiện lại sau khi mở phiếu mới).</span>
            ) : (
              <button type="button" className="lm-btn lm-btn-primary" style={{ height: 48, fontSize: 15 }} onClick={onCompanion}>Làm phiếu cho người đi cùng</button>
            )}
          </div>
        )}

        <ContactCard hotline={s.hotline} email={s.email} />
        {s.signature && <p style={{ margin: 0, fontSize: 14, lineHeight: "22px", fontStyle: "italic" }}>{s.signature}</p>}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-secondary)" }}>
          <Lock color="#4d4d4d" />Đã gửi lúc {hhmm(submission.submitted_at)} · phiếu đã khoá chỉnh sửa
        </span>
      </div>
    </main>
  );
}
