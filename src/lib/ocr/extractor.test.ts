import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extraer, normalizar } from "./extractor";
import { validar } from "./validador";

/** Texto real del OCR de una factura de ejemplo (sin retocar). */
function texto(nombre: string): string {
  return readFileSync(path.join(import.meta.dirname, "__fixtures__", `${nombre}.txt`), "utf8");
}

describe("diseño «encabezado de color» (factura_0001)", () => {
  const f = extraer(texto("factura_0001"));

  it("lee número, fecha de emisión, proveedor y cliente", () => {
    expect(f.numero).toBe("FE-000833");
    expect(f.fecha).toBe("2026-10-16");
    expect(f.proveedor).toBe("Infotec Rico Rubio S.A.");
    expect(f.nitProveedor).toBe("856162509");
    expect(f.dvProveedor).toBe(7);
    expect(f.clienteNombre).toBe("Inversiones Rangel Batista S.A.S.");
    expect(f.clienteDocumento).toBe("869745262");
    expect(f.clienteDv).toBe(3);
  });

  it("lee los ítems y une la descripción partida en dos líneas", () => {
    expect(f.items).toEqual([
      { descripcion: "Monitor LED 24 pulgadas Full HD", cantidad: 5, precioUnitario: 763900, subtotal: 3819500 },
      {
        descripcion: "Impresora multifuncional láser monocromática con red",
        cantidad: 1,
        precioUnitario: 1637500,
        subtotal: 1637500,
      },
    ]);
  });

  it("lee los totales y no ve impoconsumo donde no lo hay", () => {
    expect(f.subtotal).toBe(5457000);
    expect(f.iva).toBe(1036830);
    expect(f.total).toBe(6493830);
    // «Impresora» empieza por «Imp», pero no es la etiqueta del impoconsumo.
    expect(f.impoconsumo).toBeNull();
    expect(f.mencionaImpoconsumo).toBe(false);
  });

  it("queda aceptada: no hay motivos de revisión", () => {
    expect(validar(f)).toEqual([]);
  });
});

describe("diseño «ticket angosto» (factura_0005)", () => {
  const f = extraer(texto("factura_0005"));

  it("une la razón social partida en dos líneas", () => {
    expect(f.proveedor).toBe("ASESORÍAS INTEGRALES LEDESMA ALANIS S.A.S.");
    expect(f.nitProveedor).toBe("830269353");
  });

  it("toma la fecha de emisión, no la de la resolución ni la de vencimiento", () => {
    // El texto trae tres fechas: 28 de enero (resolución DIAN), 26 de febrero
    // (emisión) y 28 de marzo (vencimiento).
    expect(f.fecha).toBe("2026-02-26");
  });

  it("distingue el NIT del cliente del NIT del proveedor", () => {
    expect(f.clienteNombre).toBe("Homero Alaníz Regalado Cabrera Riojas");
    expect(f.clienteDocumento).toBe("868577354");
  });

  it("lee ítems cuya descripción va ANTES de la línea con los importes", () => {
    expect(f.items).toEqual([
      {
        descripcion: "Instalación y configuración de red estructurada, por punto",
        cantidad: 23,
        precioUnitario: 114800,
        subtotal: 2640400,
      },
      {
        descripcion: "Licencia anual de software de oficina por usuario",
        cantidad: 5,
        precioUnitario: 675100,
        subtotal: 3375500,
      },
    ]);
  });

  it("queda aceptada", () => {
    expect(f.total).toBe(7158921);
    expect(validar(f)).toEqual([]);
  });
});

describe("diseño «caja con borde», con impoconsumo (factura_0008)", () => {
  const f = extraer(texto("factura_0008"));

  it("lee las otras etiquetas: Señores, Fecha de expedición, Base gravable, VALOR TOTAL", () => {
    expect(f.numero).toBe("FE-000655");
    expect(f.fecha).toBe("2026-05-30");
    expect(f.proveedor).toBe("COMUNICACIONES MÓVILES PONCE ROSAS S.A.");
    expect(f.clienteNombre).toBe("Agroindustrias Montemayor Muñiz S.A.S.");
    expect(f.clienteDocumento).toBe("866596161");
    expect(f.subtotal).toBe(2130900);
    expect(f.total).toBe(2621007);
  });

  it("lee el impoconsumo aunque la etiqueta sea «Imp. consumo 4 %»", () => {
    expect(f.iva).toBe(404871);
    expect(f.impoconsumo).toBe(85236);
    expect(f.mencionaImpoconsumo).toBe(true);
  });

  it("repara con aritmética una cantidad mal leída («UA» en vez de 7)", () => {
    const ultimo = f.items[3];
    expect(ultimo.precioUnitario).toBe(144200);
    expect(ultimo.subtotal).toBe(1009400);
    expect(ultimo.cantidad).toBe(7);
  });

  it("queda aceptada: subtotal + IVA + impoconsumo = total", () => {
    expect(validar(f)).toEqual([]);
  });
});

describe("diseño «clásico con tabla» (facturas 0002, 0004 y 0007)", () => {
  it("separa la razón social del título que comparte línea", () => {
    const f = extraer(texto("factura_0002"));
    expect(f.proveedor).toBe("Servicios Profesionales Arce Gallegos S.A.S.");
    expect(f.nitProveedor).toBe("836531588"); // viene con puntos: 836.531.588-1
    expect(f.clienteNombre).toBe("Comercializadora Palacios Orta S.A.S.");
    expect(f.clienteDocumento).toBe("879905239");
  });

  it("ignora el rango de numeración y la fecha de la resolución", () => {
    const f = extraer(texto("factura_0002"));
    expect(f.numero).toBe("FE-000906"); // no FE-000001 ni FE-005000
    expect(f.fecha).toBe("2026-09-13"); // no 2026-01-11
  });

  it("elige la cantidad que cuadra, no el número de fila", () => {
    const f = extraer(texto("factura_0002"));
    // «3 | Instalación y configuración de red estructurada, 5 $94.100 19% $470.500»
    expect(f.items[2]).toMatchObject({ cantidad: 5, precioUnitario: 94100, subtotal: 470500 });
    // La cantidad de la primera fila no se leyó: se deduce de 1.077.000 / 215.400.
    expect(f.items[0]).toMatchObject({ cantidad: 5, precioUnitario: 215400, subtotal: 1077000 });
    expect(validar(f)).toEqual([]);
  });

  it("soporta líneas en blanco y fechas yyyy-mm-dd", () => {
    const f = extraer(texto("factura_0004"));
    expect(f.fecha).toBe("2026-01-30");
    expect(f.items).toHaveLength(5);
    expect(validar(f)).toEqual([]);
  });

  it("lee el impoconsumo en una factura de telefonía móvil", () => {
    const f = extraer(texto("factura_0007"));
    expect(f.items).toHaveLength(5);
    expect(f.subtotal).toBe(3464800);
    expect(f.iva).toBe(658312);
    expect(f.impoconsumo).toBe(138592);
    expect(f.total).toBe(4261704);
    expect(validar(f)).toEqual([]);
  });
});

describe("lecciones de errores reales", () => {
  it("«Responsable de IVA» no es la línea del IVA", () => {
    // Si lo fuera, el IVA quedaría en null o tomaría otra cifra.
    expect(extraer(texto("factura_0010")).iva).toBe(1906707);
  });

  it("una dirección con «$» no es un ítem («Av. 27 $ 53-18»)", () => {
    const f = extraer(texto("factura_0010"));
    expect(f.items).toHaveLength(4);
    expect(f.items.every((item) => (item.precioUnitario ?? 0) >= 100)).toBe(true);
    expect(validar(f)).toEqual([]);
  });

  it("si el NIT del proveedor no se pudo leer, no se inventa: queda en revisión", () => {
    // El OCR entregó «NIT 8808 24-0»: faltan dígitos.
    const f = extraer(texto("factura_0003"));
    expect(f.nitProveedor).toBeNull();
    // …y el documento del cliente no se confunde con el del proveedor.
    expect(f.clienteDocumento).toBe("899742694");
    expect(validar(f)).toContain("No se pudo leer el NIT del proveedor");
  });

  it("corrige los errores típicos del OCR en los importes", () => {
    expect(normalizar("Total $496 .000")).toEqual(["Total $496.000"]);
    expect(normalizar("3$146.500 S146.500")).toEqual(["3 $146.500 $146.500"]);
    expect(normalizar("uno\n\n   \ndos")).toEqual(["uno", "dos"]);
  });

  it("lee el IVA aunque la etiqueta venga pegada («IVA19%»)", () => {
    const f = extraer("Subtotal $100.000\nIVA19% $19.000\nTotal $119.000");
    expect(f.iva).toBe(19000);
  });
});

describe("lecciones de la guía que aún no tenían prueba", () => {
  // Cabecera mínima con el proveedor y el cliente de factura_0001 (documentos con DV válido).
  const cabecera = (lineaCliente: string) =>
    ["Infotec Rico Rubio S.A.", "NIT 856162509-7", "No. FE-000833", lineaCliente, "Subtotal $100.000"].join("\n");

  it("acepta un documento sin guion solo si su último dígito es un DV válido", () => {
    // El OCR perdió el guion de «869745262-3».
    const f = extraer(cabecera("Adquirente: Inversiones Rangel NIT/CC: 8697452623"));
    expect(f.clienteDocumento).toBe("869745262");
    expect(f.clienteDv).toBe(3);
  });

  it("no acepta un documento sin guion si el último dígito no es su DV", () => {
    // Podría ser un teléfono o un número mal leído: no se inventa un cliente.
    const f = extraer(cabecera("Adquirente: Inversiones Rangel NIT/CC: 8697452625"));
    expect(f.clienteDocumento).toBeNull();
  });

  it("separa cantidad, precio y subtotal pegados solo si la aritmética cuadra", () => {
    // 11 × 426.500 = 4.691.500: el «9» intermedio es el «$» mal leído.
    expect(normalizar("Licencia anual 119426.500$4.691.500")).toEqual(["Licencia anual 11 $426.500 $4.691.500"]);
    // Ninguna partición cuadra con este subtotal: los dígitos no se reparten.
    expect(normalizar("Licencia anual 119426.500$4.000.000")).toEqual(["Licencia anual 119426.500 $4.000.000"]);
  });

  it("lee como ítem la línea con cantidad, precio y subtotal pegados", () => {
    const f = extraer("Licencia anual 119426.500$4.691.500\nSubtotal $4.691.500");
    expect(f.items).toEqual([
      { descripcion: "Licencia anual", cantidad: 11, precioUnitario: 426500, subtotal: 4691500 },
    ]);
  });

  it("une la razón social partida con el título de la factura intercalado", () => {
    const f = extraer(
      ["Servicios Profesionales Arce Gallegos FACTURA ELECTRÓNICA DE", "S.A.S. VENTA", "NIT: 836.531.588-1 No. FE-000906"].join("\n"),
    );
    expect(f.proveedor).toBe("Servicios Profesionales Arce Gallegos S.A.S.");
  });

  it("«Monitor» contiene «nit», pero no es una etiqueta de cliente", () => {
    const f = extraer(["Infotec Rico Rubio S.A.", "NIT 856162509-7", "Monitor de referencia 869745262-3", "Subtotal $1.000"].join("\n"));
    expect(f.clienteDocumento).toBeNull();
  });
});

describe("validador: cada regla produce su motivo", () => {
  const buena = () => extraer(texto("factura_0001"));

  it("el total que no cuadra", () => {
    expect(validar({ ...buena(), total: 6500000 })).toContain("El total no es subtotal + IVA + impoconsumo");
  });

  it("un IVA que no es el 19 %", () => {
    const f = buena();
    const iva = Math.round(f.subtotal! * 0.05);
    expect(validar({ ...f, iva, total: f.subtotal! + iva })).toContain("El IVA no es el 19 % del subtotal");
  });

  it("el dígito de verificación del cliente equivocado", () => {
    expect(validar({ ...buena(), clienteDv: 9 })).toContain(
      "El dígito de verificación del documento del cliente no es válido",
    );
  });

  it("los ítems que no suman el subtotal", () => {
    const f = buena();
    expect(validar({ ...f, items: f.items.slice(0, 1) })).toContain("Los ítems no suman el subtotal");
  });

  it("un ítem cuya cantidad por precio no da su subtotal", () => {
    const f = buena();
    const items = [{ ...f.items[0], cantidad: 4 }, f.items[1]];
    expect(validar({ ...f, items })).toContain("Ítem 1: cantidad × precio no da el subtotal");
  });

  it("un impoconsumo que no es el 4 %", () => {
    const f = extraer(texto("factura_0008"));
    expect(validar({ ...f, impoconsumo: 90000, total: f.subtotal! + f.iva! + 90000 })).toContain(
      "El impoconsumo no es el 4 % del subtotal",
    );
  });

  it("un impoconsumo mencionado pero ilegible", () => {
    const f = extraer(texto("factura_0008"));
    expect(validar({ ...f, impoconsumo: null })).toContain(
      "La factura menciona impoconsumo pero no se pudo leer su valor",
    );
  });

  it("los campos obligatorios y la razón social ilegible", () => {
    const motivos = validar({ ...buena(), numero: null, fecha: null, proveedor: "S.A." });
    expect(motivos).toContain("No se pudo leer el número de factura");
    expect(motivos).toContain("No se pudo leer la fecha de emisión");
    expect(motivos).toContain("La razón social del proveedor no es legible");
  });
});
