"use client";
import { useEffect, useRef, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { api } from "@/lib/api";

const WELCOME_MS = 10000;

export default function WelcomePage() {
  const [welcome, setWelcome] = useState<{ name: string; message: string } | null>(null);
  const timerRef = useRef<any>(null);

  const { connected } = useWebSocket((data) => {
    if (data?.type === "welcome" && data.display_name) {
      setWelcome({ name: data.display_name, message: data.display_message || "" });
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setWelcome(null), WELCOME_MS);
    }
  });

  useEffect(() => {
    if (connected) return;

    let lastEventId: string | null = null;
    let isInitial = true;

    const poll = async () => {
      try {
        const res = await api("/checkin/welcome/latest");
        if (res && res.id) {
          if (isInitial) {
            isInitial = false;
            lastEventId = res.id;
            // Only show welcome on initial load if the event is very fresh
            const diff = Date.now() - new Date(res.created_at).getTime();
            if (diff < WELCOME_MS) {
              setWelcome({ name: res.display_name, message: res.display_message || "" });
              clearTimeout(timerRef.current);
              timerRef.current = setTimeout(() => setWelcome(null), WELCOME_MS);
            }
            return;
          }

          if (res.id !== lastEventId) {
            lastEventId = res.id;
            setWelcome({ name: res.display_name, message: res.display_message || "" });
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setWelcome(null), WELCOME_MS);
          }
        }
      } catch (err) {
        console.error("Failed to poll latest welcome:", err);
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [connected]);

  useEffect(() => () => clearTimeout(timerRef.current), []);


  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center text-center overflow-hidden"
      style={{ background: "linear-gradient(160deg,#00B7CC 0%,#0D3B42 100%)" }}>
      {welcome ? (
        <div className="px-8 animate-[fadeIn_.6s_ease]">
          <div className="text-white/80 text-2xl md:text-3xl mb-6 tracking-widest">CHÀO MỪNG ANH/CHỊ</div>
          <h1 className="text-white text-6xl md:text-8xl font-bold mb-8 leading-tight">{welcome.name}</h1>
          <div className="text-white text-3xl md:text-4xl font-medium mb-4">Đến với Workshop Chuyển</div>
          <div className="text-white/85 text-xl md:text-2xl">Hi Sweetie Việt Nam rất vui được đón tiếp anh/chị</div>
        </div>
      ) : (
        <div className="px-8">
          <div className="text-white/70 text-lg md:text-xl tracking-[0.3em] mb-6">HI SWEETIE VIỆT NAM</div>
          <h1 className="text-white text-5xl md:text-7xl font-bold mb-10">WORKSHOP CHUYỂN</h1>
          <div className="text-white text-2xl md:text-3xl mb-3">Vui lòng đến quầy check-in</div>
          <div className="text-white/80 text-lg md:text-xl">Hi Sweetie Việt Nam hân hạnh chào đón quý khách</div>
        </div>
      )}
      <style>{`@keyframes fadeIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
    </main>
  );
}
