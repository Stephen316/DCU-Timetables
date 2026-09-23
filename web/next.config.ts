import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverActions: {
      // Ask uploads documents through a Server Action, which Next caps at 1 MB by default.
      // A phone photo or a scanned PDF is often more, and the request then failed before
      // the action ran — a Send button that did nothing. Vercel refuses a request body
      // over 4.5 MB whatever this says, so 4 MB is the most that can actually arrive.
      bodySizeLimit: "4mb",
    },
  },
};

export default config;
