"use client";

import FadeIn from "../FadeIn";
import type { LandingProgram } from "../types";

interface ProgramSectionProps {
  program: LandingProgram;
}

export default function ProgramSection({ program }: ProgramSectionProps) {
  return (
    <section id="program" className="ws-program">
      <FadeIn y={40}>
        <div className="ws-program-lead">
          <h2 className="ws-program-heading">{program.heading}</h2>
          <p>Từ khám phá → kết nối → cập nhật xu hướng → ứng dụng thực tế</p>
        </div>
      </FadeIn>

      <ul className="ws-program-list">
        {program.items.map((item, index) => (
          <li key={`${index}-${item.title}`} className="ws-program-item-wrap">
            <FadeIn delay={index * 0.1} y={30}>
              <div className="ws-program-item">
                <span className="ws-program-time">
                  {item.meta?.trim() || String(index + 1).padStart(2, "0")}
                </span>
                <div className="ws-program-body">
                  <h3 className="ws-program-title">{item.title}</h3>
                  {item.description && <p className="ws-program-desc">{item.description}</p>}
                </div>
              </div>
            </FadeIn>
          </li>
        ))}
      </ul>
    </section>
  );
}
