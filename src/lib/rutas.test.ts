import { describe, expect, it } from "vitest";
import { idProcesoValido, nombreLimpio, prefijoProceso, rutaImagen } from "./rutas";

describe("nombres de archivo en el almacén", () => {
  it("arma procesos/<id>/<NNNN>-<nombre>.<extensión del tipo real>", () => {
    expect(rutaImagen("abc123", 7, "factura_0007.jpg", "jpeg")).toBe("procesos/abc123/0007-factura_0007.jpg");
    expect(prefijoProceso("abc123")).toBe("procesos/abc123/");
  });

  it("la extensión sale del tipo real, no del nombre que envió el navegador", () => {
    // Un JPEG guardado como .png queda con .jpg.
    expect(rutaImagen("abc123", 1, "escaneo.png", "jpeg")).toBe("procesos/abc123/0001-escaneo.jpg");
    expect(rutaImagen("abc123", 2, "sin-extension", "png")).toBe("procesos/abc123/0002-sin-extension.png");
  });

  it("limpia el nombre: sin carpetas, tildes, espacios ni símbolos", () => {
    expect(nombreLimpio("Facturas Año 2026/Factura Ñandú (copia).PNG")).toBe("Factura-Nandu-copia");
    expect(nombreLimpio("C:\\Users\\PC\\factura 1.jpeg")).toBe("factura-1");
  });

  it("un nombre no puede salirse de la carpeta del lote", () => {
    expect(rutaImagen("abc123", 3, "../../otro-lote/x.png", "png")).toBe("procesos/abc123/0003-x.png");
  });

  it("un nombre vacío o solo de símbolos recibe uno por defecto, y uno enorme se recorta", () => {
    expect(nombreLimpio("???.png")).toBe("archivo");
    expect(nombreLimpio("")).toBe("archivo");
    expect(nombreLimpio(`${"a".repeat(300)}.png`)).toHaveLength(60);
  });

  it("solo acepta identificadores de lote con forma de ID de Firestore", () => {
    expect(idProcesoValido("Xk29fLmQ0pZr8sTuVw3y")).toBe(true);
    expect(idProcesoValido("../clientes")).toBe(false);
    expect(idProcesoValido("a/b")).toBe(false);
    expect(idProcesoValido("")).toBe(false);
  });
});
