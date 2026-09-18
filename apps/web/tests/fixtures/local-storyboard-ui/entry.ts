import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { AdminStoryboardGenerator } from "../../../components/admin/storyboard/AdminStoryboardGenerator";

const container = document.getElementById("root");
if (!container) throw new Error("storyboard UI harness root element is missing");
createRoot(container).render(createElement(AdminStoryboardGenerator));
