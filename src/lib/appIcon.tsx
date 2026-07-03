const INK = "#18181b";
const PAPER = "#fafafa";

/** Shared archery-target mark, rendered at whatever pixel size the caller's ImageResponse size config specifies — every ring is a relative percentage, so one JSX tree covers every icon size from 32px to 512px. */
export function AppIconMark() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: INK,
        borderRadius: "22%",
      }}
    >
      <div
        style={{
          width: "76%",
          height: "76%",
          borderRadius: "50%",
          background: PAPER,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "60%",
            height: "60%",
            borderRadius: "50%",
            background: INK,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "58%",
              height: "58%",
              borderRadius: "50%",
              background: PAPER,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "40%",
                height: "40%",
                borderRadius: "50%",
                background: INK,
                display: "flex",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
