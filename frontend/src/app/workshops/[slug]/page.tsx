"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { getWorkshopLandingPage, type WorkshopLandingPagePublic, type WorkshopMedia } from "@/lib/api";
import { formatEventDate, formatEventDateTime } from "@/lib/date-format";
import "./landing-v2.css";

export const dynamic = "force-dynamic";

const BENEFITS: Array<{ icon: "drink" | "trend" | "recipe" | "gift"; title: string; items: string[] }> = [
  {
    icon: "drink",
    title: "Trải nghiệm hệ sinh thái nguyên liệu",
    items: ["40+ vị mứt & syrup", "30+ loại topping", "20+ vị Trà Phượng Hoàng"],
  },
  {
    icon: "trend",
    title: "Cập nhật xu hướng thị trường",
    items: ["Xu hướng đồ uống trong & ngoài nước", "Nguyên liệu, topping đang được quan tâm", "Gợi ý hướng phát triển menu mới"],
  },
  {
    icon: "recipe",
    title: "Bộ công thức Trending",
    items: ["Trải nghiệm các món đang lên xu hướng", "Công thức dễ ứng dụng", "Thêm ý tưởng làm mới menu"],
  },
  {
    icon: "gift",
    title: "Quà tặng dành riêng",
    items: ["Quà tặng từ LerMao & Trà Phượng Hoàng", "Tài liệu/công thức mang về", "Ưu đãi dành riêng cho khách tham dự"],
  },
];

const EXPERIENCE_STEPS = [
  {
    time: "13:00",
    title: "Đón khách & trải nghiệm không gian workshop",
    description: "Khách tham quan và trải nghiệm hơn 10 dòng trà của Trà Phượng Hoàng, khám phá 20+ topping từ trân châu nấu nhanh, thạch, kem foam đến các món trà, đồng thời thưởng thức những công thức đồ uống xu hướng được đội ngũ BID pha chế trực tiếp.",
  },
  {
    time: "14:30",
    title: "Chia sẻ xu hướng thị trường cùng các chuyên gia",
    description: "Chia sẻ về xu hướng ngành F&B, tư duy xây dựng menu, kinh nghiệm kinh doanh và những góc nhìn thực tế giúp chủ quán tối ưu vận hành và gia tăng doanh thu.",
  },
  {
    time: "15:30",
    title: "Live Demo – Khám phá công thức mới",
    description: "Trực tiếp thưởng thức hơn 5 công thức đồ uống độc đáo với sự kết hợp giữa trà, mứt, topping và các nguyên liệu theo xu hướng, được đội ngũ BID trình diễn ngay tại Workshop.",
  },
  {
    time: "16:30",
    title: "Bế mạc & giao lưu",
    description: "Khép lại Workshop với hoạt động chụp ảnh lưu niệm, nhận quà từ nhà tài trợ và giao lưu, kết nối cùng các đối tác, đội ngũ LerMao và cộng đồng chủ quán F&B.",
  },
];

const AUDIENCES = [
  ["Đang vận hành quán hoặc chuỗi", "Cập nhật nguyên liệu, topping và hướng phát triển menu mới."],
  ["Đại lý và nhà phân phối", "Tìm hiểu danh mục SKU, chính sách phân phối và hỗ trợ bán."],
  ["Đang chuẩn bị mở quán", "Nhận gợi ý combo nhập thử và set menu khởi điểm."],
  ["Trung tâm đào tạo, dạy nghề, setup", "Cập nhật công thức, nguyên liệu và giải pháp ứng dụng cho học viên, khách hàng."],
];

const FAQS = [
  ["Workshop có mất phí không?", "Hoàn toàn miễn phí. Bạn chỉ cần đăng ký trước để giữ chỗ — số lượng tham dự có giới hạn theo sức chứa địa điểm."],
  ["Tôi chưa mở quán, có nên tham dự không?", "Có. Workshop dành cho cả người đang chuẩn bị mở quán. Bạn sẽ nhận được combo nhập thử gợi ý, set menu khởi điểm và lộ trình triển khai từ đội ngũ LerMao."],
  ["Tôi có thể đem đồng đội đi cùng không?", "Bạn có thể đăng ký theo nhóm 2–3 người cho cùng một quán/chuỗi. Vui lòng ghi chú số lượng trong form đăng ký để chúng tôi sắp xếp chỗ ngồi."],
  ["Có được nhận sample mang về không?", "Có. Khách đăng ký sớm sẽ nhận sample mứt, topping & trà nền theo nhóm sản phẩm phù hợp mô hình quán đã đăng ký."],
];

function imageMedia(media: WorkshopMedia): boolean {
  return (media.mime_type || "").startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(media.file_url);
}

export default function WorkshopLandingPageV2({ params }: { params: { slug: string } }) {
  const [landing, setLanding] = useState<WorkshopLandingPagePublic | null>(null);
  const [error, setError] = useState("");
  const [formHeight, setFormHeight] = useState(700);
  const [successModal, setSuccessModal] = useState<{ zaloGroupUrl: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const closeSuccessModal = () => {
    setSuccessModal(null);
    iframeRef.current?.contentWindow?.postMessage({ type: "registration-reset" }, window.location.origin);
  };

  useEffect(() => {
    let active = true;
    getWorkshopLandingPage(params.slug)
      .then((data) => active && setLanding(data))
      .catch(() => active && setError("Landing page không tồn tại hoặc chưa được tạo."));
    return () => { active = false; };
  }, [params.slug]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "registration-form-height") {
        const height = Number(event.data.height);
        if (Number.isFinite(height)) setFormHeight(Math.max(280, Math.min(1200, height)));
        return;
      }
      if (event.data?.type === "registration-success") {
        const zaloGroupUrl = typeof event.data.zaloGroupUrl === "string" ? event.data.zaloGroupUrl : "";
        if (zaloGroupUrl) setSuccessModal({ zaloGroupUrl });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!successModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeSuccessModal(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [successModal]);

  useEffect(() => {
    if (!landing) return;

    const header = document.getElementById("site-header");
    const onScroll = () => {
      if (header) header.dataset.scrolled = window.scrollY > 8 ? "true" : "false";
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const items = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let io: IntersectionObserver | null = null;

    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-in"));
    } else {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-in");
            io?.unobserve(entry.target);
          });
        },
        { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
      );
      items.forEach((el, i) => {
        el.style.transitionDelay = `${Math.min(i % 4, 3) * 70}ms`;
        io!.observe(el);
      });
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      io?.disconnect();
    };
  }, [landing]);

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F7FAFC] px-5 text-[#1A202C]">
        <div className="max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-8 text-center shadow-[0_8px_24px_rgba(0,183,233,.16)]">
          <p className="text-xs font-extrabold uppercase tracking-[.12em] text-[#007FA8]">Không thể mở trang</p>
          <h1 className="mt-3 text-2xl font-bold">Landing page chưa khả dụng</h1>
          <p className="mt-3 text-sm leading-6 text-[#4A5568]">{error}</p>
        </div>
      </main>
    );
  }

  if (!landing) {
    return <main className="grid min-h-screen place-items-center bg-white text-sm font-medium text-[#4A5568]" aria-busy="true">Đang tải thông tin workshop…</main>;
  }

  const banner = landing.media.find((item) => item.media_type === "banner" && imageMedia(item))
    || landing.media.find(imageMedia);
  const registrationOpen = landing.status === "published" && landing.registration_form.is_active;
  const registerUrl = `/register/${landing.registration_form.token}?workshop=${encodeURIComponent(landing.id)}&embedded=1`;
  const eventTime = formatEventDateTime(landing.event_date, landing.event_time, true);
  const zaloGroupUrl = landing.zalo_group_url || "";

  return (
    <div className="landing-v2">
      <a className="skip" href="#main-content">Đến nội dung chính</a>
      <a className="skip skip-2" href="#registration-form">Đến form đăng ký</a>

      <header className="header" id="site-header">
        <div className="wrap header-in">
          <a className="brand" href="#main-content">
            <img src="/landing-v2/logo-lermao.webp" alt="" width="42" height="42" />
            <span>LerMao</span>
          </a>
          <nav className="nav" aria-label="Menu chính">
            <a href="#thong-tin">Lợi ích</a>
            <a href="#chuong-trinh">Chương trình</a>
            <a href="#faq">FAQ</a>
            <a href="#dang-ky">Đăng ký</a>
          </nav>
          <a className="btn btn-primary" href="#registration-form">Đăng ký workshop</a>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="hero" id="dang-ky" style={{ scrollMarginTop: 88 }}>
          <div className="hero-bg" aria-hidden="true">
            <img src="/landing-v2/hero-workshop.jpg" alt="" width="1792" height="1024" fetchPriority="high" />
          </div>

          <div className="wrap hero-grid">
            <div className="hero-main">
              <span className="eyebrow eyebrow--dot">
                Workshop{landing.branch ? ` · ${landing.branch}` : ""}{landing.event_date ? ` · ${formatEventDate(landing.event_date)}` : ""}
              </span>

              <h1>{landing.name}</h1>

              {landing.registration_form.greeting && (
                <p className="hero-greeting">{landing.registration_form.greeting}</p>
              )}

              <div className="facts" aria-label="Thông tin chính của workshop">
                {(landing.event_date || landing.event_time) && (
                  <div className="fact">
                    <span className="fact-label">Thời gian</span>
                    <strong className="fact-value">{eventTime}</strong>
                  </div>
                )}
                {landing.location && (
                  <div className="fact">
                    <span className="fact-label">Địa điểm</span>
                    {landing.maps_url ? (
                      <a href={landing.maps_url} target="_blank" rel="noreferrer">
                        <strong className="fact-value">{landing.location}</strong>
                      </a>
                    ) : (
                      <strong className="fact-value">{landing.location}</strong>
                    )}
                  </div>
                )}
                <div className="fact fact-hot">
                  <span className="fact-label">Đăng ký</span>
                  <strong className="fact-value">
                    {registrationOpen ? "🔥 Chỉ còn 20 suất miễn phí cuối cùng" : "Hiện chưa nhận đăng ký"}
                  </strong>
                </div>
              </div>

              {zaloGroupUrl && (
                <div className="zalo-block" aria-label="Zalo Group Workshop">
                  <div className="zalo-block-info">
                    <h2 className="zalo-block-title">💬 Zalo Group Workshop</h2>
                    <p className="zalo-block-desc">
                      Tham gia group để cập nhật lịch trình, công thức, slide và media sự kiện.
                    </p>
                    <a href={zaloGroupUrl} target="_blank" rel="noreferrer" className="zalo-block-cta">
                      Tham gia Group Zalo
                    </a>
                    <p className="zalo-block-hint">Quét QR hoặc nhấn nút để tham gia</p>
                  </div>
                  <div className="zalo-block-qr" aria-label="Mã QR tham gia Group Zalo">
                    <QRCode value={zaloGroupUrl} size={104} bgColor="#ffffff" fgColor="#0D3B42" level="M" />
                  </div>
                </div>
              )}

              <p className="assure">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                <span>Thông tin được bảo mật và chỉ dùng để hỗ trợ suất tham dự.</span>
              </p>
            </div>

            <article className="reg-shell" id="registration-form">
              <div className="reg-core">
                {registrationOpen ? (
                  <iframe
                    ref={iframeRef}
                    src={registerUrl}
                    title={`Form đăng ký ${landing.name}`}
                    style={{ height: formHeight }}
                  />
                ) : (
                  <div role="status" className="px-7 py-12 text-center">
                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#E6F7FD] text-2xl font-extrabold text-[#0090C0]">×</div>
                    <h2 className="mt-5 text-2xl font-bold">Workshop đã đóng đăng ký</h2>
                    <p className="mt-3 text-sm leading-6 text-[#4A5568]">Sự kiện hiện không nhận thêm đăng ký. Vui lòng liên hệ hotline để được hỗ trợ.</p>
                    <a href="tel:+84973123230" className="mt-6 inline-flex min-h-11 items-center rounded-lg border-2 border-[#00B7E9] px-5 py-2 font-bold text-[#007FA8]">Gọi 0973 123 230</a>
                  </div>
                )}
              </div>
            </article>

            {banner && (
              <figure className="poster" id="poster">
                <img src={banner.file_url} alt={`Poster ${landing.name}`} loading="lazy" width="1792" height="1024" />
              </figure>
            )}
          </div>
        </section>

        <section className="section benefits" id="thong-tin" style={{ scrollMarginTop: 88 }}>
          <div className="wrap">
            <div className="sec-head reveal">
              <span className="eyebrow">Lợi ích độc quyền</span>
              <h2 className="h2">Vì sao bạn không nên bỏ lỡ sự kiện này?</h2>
            </div>

            <div className="b-grid">
              {BENEFITS.map((benefit, idx) => (
                <article key={benefit.title} className="b-card reveal">
                  <div className="b-media">
                    <img src={`/landing-v2/benefit-${idx + 1}.jpg`} alt="" loading="lazy" width="1400" height="1050" />
                    <span className="b-num" aria-hidden="true">{String(idx + 1).padStart(2, "0")}</span>
                  </div>
                  <div className="b-body">
                    <h3>{benefit.title}</h3>
                    <ul className="b-list">
                      {benefit.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>

            {registrationOpen && (
              <div className="b-cta reveal">
                <a className="btn btn-primary btn-lg" href="#registration-form">
                  Giữ chỗ tham dự
                  <span className="btn-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></svg></span>
                </a>
              </div>
            )}
          </div>
        </section>

        <section className="section program" id="chuong-trinh" style={{ scrollMarginTop: 88 }}>
          <div className="wrap">
            <div className="sec-head sec-head-wide reveal">
              <span className="eyebrow">Lộ trình trải nghiệm</span>
              <h2 className="h2">Từ khám phá → Kết nối → Cập nhật xu hướng → Ứng dụng thực tế</h2>
            </div>

            <div className="tl-layout">
              <ol className="tl">
                {EXPERIENCE_STEPS.map((step) => (
                  <li key={step.time} className="tl-item reveal">
                    <time className="tl-time" dateTime={step.time}>{step.time}</time>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="tl-aside">
                <figure className="tl-shot reveal">
                  <img src="/landing-v2/demo-1.jpg" alt="" loading="lazy" width="1024" height="683" />
                  <figcaption>Đội ngũ BID pha chế trực tiếp tại quầy demo.</figcaption>
                </figure>
                <figure className="tl-shot reveal">
                  <img src="/landing-v2/demo-2.jpg" alt="" loading="lazy" width="1024" height="683" />
                  <figcaption>Khách tham dự nếm thử và ghi lại công thức ngay tại chỗ.</figcaption>
                </figure>
              </div>
            </div>
          </div>
        </section>

        <section className="audience">
          <div className="aud-bg" aria-hidden="true">
            <img src="/landing-v2/atmos-fullbleed.jpg" alt="" loading="lazy" width="1792" height="1024" />
          </div>
          <div className="wrap">
            <div className="sec-head sec-head-left reveal">
              <span className="eyebrow eyebrow--light">Ai nên tham dự?</span>
              <h2 className="h2">Workshop dành cho 4 nhóm khách hàng F&B</h2>
            </div>

            <div className="aud-grid reveal">
              {AUDIENCES.map(([title, description]) => (
                <article key={title} className="aud-card">
                  <div className="aud-mark" aria-hidden="true"></div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>

            <div className="aud-cta reveal">
              <a className="btn btn-primary btn-lg" href="#registration-form">
                Giữ chỗ miễn phí
                <span className="btn-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></svg></span>
              </a>
            </div>
          </div>
        </section>

        <section className="section faq" id="faq" style={{ scrollMarginTop: 88 }}>
          <div className="faq-wrap">
            <div className="sec-head reveal">
              <span className="eyebrow">FAQ</span>
              <h2 className="h2">Câu hỏi thường gặp</h2>
            </div>

            <div className="faq-list reveal">
              {FAQS.map(([question, answer]) => (
                <details key={question} className="faq-item">
                  <summary>
                    <span>{question}</span>
                    <span className="faq-sign" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></span>
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <div className="f-logos">
            <img className="f-logo-1" src="/landing-v2/logo-lermao.webp" alt="LerMao" loading="lazy" />
            <img className="f-logo-2" src="/landing-v2/logo-dieptra.webp" alt="Diệp Trà LerMao" loading="lazy" />
            <img className="f-logo-3" src="/landing-v2/logo-traphuonghoang.webp" alt="Trà Phượng Hoàng" loading="lazy" />
          </div>

          <p className="f-desc">Giải pháp nguyên liệu và công thức cho ngành đồ uống.<br />40,000+ đối tác — phủ sóng 50+ tỉnh thành Việt Nam.</p>

          <div className="f-actions">
            <a className="f-btn" href="tel:+84973123230">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.62a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.84.29 1.72.5 2.62.62" /></svg>
              0973 123 230
            </a>
            <a className="f-btn" href="https://zalo.me/0973123230" target="_blank" rel="noreferrer">Zalo</a>
            <a className="f-btn" href="https://www.facebook.com/lermao.sanhannhugau" target="_blank" rel="noreferrer">Facebook</a>
          </div>

          <div className="f-fine">
            Bảng giá có thể thay đổi theo thời điểm và chính sách phân phối. Vui lòng liên hệ đội ngũ kinh doanh để nhận báo giá cập nhật nhất.<br />
            © 2026 LerMao · Hi Sweetie Việt Nam. Email: <a href="mailto:cskh@hisweetievietnam.com.vn">cskh@hisweetievietnam.com.vn</a>
          </div>
        </div>
      </footer>

      <div className="floats">
        <a className="float float-zalo" href="https://zalo.me/0973123230" target="_blank" rel="noreferrer" aria-label="Chat Zalo">Z</a>
        <a className="float float-fb" href="https://www.facebook.com/lermao.sanhannhugau" target="_blank" rel="noreferrer" aria-label="Facebook">f</a>
        <a className="float float-call" href="tel:+84973123230" aria-label="Gọi điện">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.62a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.84.29 1.72.5 2.62.62" /></svg>
        </a>
      </div>

      <nav className="mbar" aria-label="Hành động nhanh">
        <a className="mbar-primary" href="#registration-form">{registrationOpen ? "Giữ chỗ miễn phí" : "Xem thông tin"}</a>
        <a className="mbar-call" href="tel:+84973123230">Gọi tư vấn</a>
      </nav>

      {successModal && (
        <div className="zalo-modal-overlay" role="presentation" onClick={closeSuccessModal}>
          <div
            className="zalo-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="zalo-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="zalo-modal-close" aria-label="Đóng" onClick={closeSuccessModal}>×</button>
            <div className="zalo-modal-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <h2 id="zalo-modal-title" className="zalo-modal-title">Đăng ký thành công! 🎉</h2>
            <p className="zalo-modal-lead">Vui lòng tham gia Group Zalo để nhận:</p>
            <ul className="zalo-modal-list">
              <li>📢 Thông báo &amp; lịch trình Workshop</li>
              <li>🥤 Bộ công thức sau chương trình</li>
              <li>📑 Slide &amp; tài liệu chia sẻ</li>
              <li>📸 Hình ảnh, video &amp; media sự kiện</li>
            </ul>
            <div className="zalo-modal-qr" aria-label="Mã QR tham gia Group Zalo">
              <QRCode value={successModal.zaloGroupUrl} size={150} bgColor="#ffffff" fgColor="#0D3B42" level="M" />
            </div>
            <a className="zalo-modal-cta" href={successModal.zaloGroupUrl} target="_blank" rel="noreferrer">
              Tham gia Group Zalo Ngay
            </a>
            <p className="zalo-modal-note">Công thức, slide và media của chương trình sẽ được cập nhật trực tiếp trong Zalo Group.</p>
          </div>
        </div>
      )}
    </div>
  );
}
