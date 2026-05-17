import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#22c55e",
          borderRadius: 40,
        }}
      >
        <svg width="90" height="100" viewBox="0 0 18 20" fill="none">
          <path d="M2 1.5L16 10L2 18.5V1.5Z" fill="#000000" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
