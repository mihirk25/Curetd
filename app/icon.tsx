import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 7,
        }}
      >
        <svg width="18" height="20" viewBox="0 0 18 20" fill="none">
          <path d="M2 1.5L16 10L2 18.5V1.5Z" fill="#000000" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
