import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  MY_CLASSES_LOGIN_HREF,
  MyClassesAccessState,
} from "./MyClassesAccessState";

describe("MyClassesAccessState", () => {
  it("shows the login state without rendering private content", () => {
    const renderPrivateContent = vi.fn();

    function PrivateContent() {
      renderPrivateContent();
      return createElement("p", null, "Reserva privada");
    }

    const html = renderToStaticMarkup(
      createElement(
        MyClassesAccessState,
        { isAuthenticated: false, isLoading: false },
        createElement(PrivateContent)
      )
    );

    expect(html).toContain(
      "Debes iniciar sesión para ver tus clases y paquetes."
    );
    expect(html).toContain("Iniciar sesión");
    expect(html).toContain(`href="${MY_CLASSES_LOGIN_HREF}"`);
    expect(html).not.toContain("Reserva privada");
    expect(renderPrivateContent).not.toHaveBeenCalled();
  });

  it("keeps authenticated content visible without the login state", () => {
    const html = renderToStaticMarkup(
      createElement(
        MyClassesAccessState,
        { isAuthenticated: true, isLoading: false },
        createElement("p", null, "Tus reservas y paquetes")
      )
    );

    expect(html).toContain("Tus reservas y paquetes");
    expect(html).not.toContain(
      "Debes iniciar sesión para ver tus clases y paquetes."
    );
    expect(html).not.toContain(MY_CLASSES_LOGIN_HREF);
  });
});
