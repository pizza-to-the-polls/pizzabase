import {
  parseDigitalSourceType,
  DIGITAL_SOURCE_TYPE_LABELS,
} from "./digitalSourceType";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal XMP XML document containing a DigitalSourceType. */
function xmpWithDst(uri: string, useRdfResource = false): string {
  const dstElement = useRdfResource
    ? `<Iptc4xmpExt:DigitalSourceType rdf:resource="${uri}"/>`
    : `<Iptc4xmpExt:DigitalSourceType>${uri}</Iptc4xmpExt:DigitalSourceType>`;

  return [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '    <rdf:Description rdf:about=""',
    '      xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">',
    `      ${dstElement}`,
    "    </rdf:Description>",
    "  </rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseDigitalSourceType", () => {
  // -----------------------------------------------------------------------
  // Known URI parsing from XMP element text
  // -----------------------------------------------------------------------

  it("parses digitalCapture from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    );
    expect(result.label).toBe("digital capture");
  });

  it("parses trainedAlgorithmicMedia from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    );
    expect(result.label).toBe("AI-generated media");
  });

  it("parses screenCapture from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/screenCapture",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/screenCapture",
    );
    expect(result.label).toBe("screen capture");
  });

  it("parses screenRecording from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/screenRecording",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/screenRecording",
    );
    expect(result.label).toBe("screen recording");
  });

  it("parses compositeSynthetic from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/compositeSynthetic",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/compositeSynthetic",
    );
    expect(result.label).toBe("composite / synthetic");
  });

  it("parses composite from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/composite",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.label).toBe("composite");
  });

  it("parses virtualRecording from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/virtualRecording",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.label).toBe("virtual recording");
  });

  it("parses negativeFilm from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/negativeFilm",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.label).toBe("negative film");
  });

  it("parses positiveFilm from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/positiveFilm",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.label).toBe("positive film");
  });

  it("parses scannedImage from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/scannedImage",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.label).toBe("scanned image");
  });

  it("parses dataDrivenMedia from XMP element text", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/dataDrivenMedia",
    );
    const result = parseDigitalSourceType(xml);
    expect(result.label).toBe("data-driven media");
  });

  // -----------------------------------------------------------------------
  // rdf:resource attribute form
  // -----------------------------------------------------------------------

  it("parses DigitalSourceType from rdf:resource attribute", () => {
    const xml = xmpWithDst(
      "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
      true,
    );
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    );
    expect(result.label).toBe("digital capture");
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("returns null for empty input", () => {
    expect(parseDigitalSourceType("")).toEqual({ uri: null, label: null });
  });

  it("returns null for whitespace-only input", () => {
    expect(parseDigitalSourceType("   ")).toEqual({ uri: null, label: null });
  });

  it("returns null for invalid XML", () => {
    expect(parseDigitalSourceType("not xml at all")).toEqual({
      uri: null,
      label: null,
    });
  });

  it("returns null for XMP with no DigitalSourceType", () => {
    const xml = [
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '    <rdf:Description rdf:about=""',
      '      xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">',
      "      <Iptc4xmpExt:LocationCreated>",
      "        <rdf:Description/>",
      "      </Iptc4xmpExt:LocationCreated>",
      "    </rdf:Description>",
      "  </rdf:RDF>",
      "</x:xmpmeta>",
    ].join("\n");
    expect(parseDigitalSourceType(xml)).toEqual({ uri: null, label: null });
  });

  it("handles multiple rdf:Description blocks", () => {
    const xml = [
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '    <rdf:Description rdf:about=""',
      '      xmlns:dc="http://purl.org/dc/elements/1.1/">',
      "      <dc:creator>Someone</dc:creator>",
      "    </rdf:Description>",
      '    <rdf:Description rdf:about=""',
      '      xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">',
      "      <Iptc4xmpExt:DigitalSourceType>",
      "        http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
      "      </Iptc4xmpExt:DigitalSourceType>",
      "    </rdf:Description>",
      "  </rdf:RDF>",
      "</x:xmpmeta>",
    ].join("\n");
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    );
  });

  it("handles different namespace prefix for Iptc4xmpExt", () => {
    const xml = [
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '    <rdf:Description rdf:about=""',
      '      xmlns:iptc="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">',
      "      <iptc:DigitalSourceType>",
      "        http://cv.iptc.org/newscodes/digitalsourcetype/screenCapture",
      "      </iptc:DigitalSourceType>",
      "    </rdf:Description>",
      "  </rdf:RDF>",
      "</x:xmpmeta>",
    ].join("\n");
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/screenCapture",
    );
    expect(result.label).toBe("screen capture");
  });

  it("uses the URI as label when not in the known map", () => {
    const unknownUri =
      "http://cv.iptc.org/newscodes/digitalsourcetype/unknownType";
    const xml = xmpWithDst(unknownUri);
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(unknownUri);
    expect(result.label).toBe(unknownUri);
  });

  it("trims whitespace from the URI value", () => {
    const xml = [
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '    <rdf:Description rdf:about=""',
      '      xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">',
      "      <Iptc4xmpExt:DigitalSourceType>",
      "        http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture ",
      "      </Iptc4xmpExt:DigitalSourceType>",
      "    </rdf:Description>",
      "  </rdf:RDF>",
      "</x:xmpmeta>",
    ].join("\n");
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    );
    expect(result.label).toBe("digital capture");
  });

  // -----------------------------------------------------------------------
  // Safety
  // -----------------------------------------------------------------------

  it("does not throw on deeply nested XML", () => {
    const xmlParts = [
      '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    ];
    for (let i = 0; i < 200; i++) {
      xmlParts.push(
        `<rdf:Description rdf:about="" xmlns:ns${i}="http://ns${i}.example.com/">`,
      );
    }
    xmlParts.push(
      "<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture</Iptc4xmpExt:DigitalSourceType>",
    );
    for (let i = 0; i < 200; i++) {
      xmlParts.push("</rdf:Description>");
    }
    xmlParts.push("  </rdf:RDF>");
    xmlParts.push("</x:xmpmeta>");

    const result = parseDigitalSourceType(xmlParts.join("\n"));
    // Deep nesting may exceed parser recursion limits; the parser is safe
    // (no throw) but may return null for deeply buried values.
    expect(result).toBeDefined();
  });

  it("does not throw on XML with entity declarations (XXE safety)", () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<!DOCTYPE foo [",
      '  <!ENTITY xxe "file:///etc/passwd">',
      "]>",
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '    <rdf:Description rdf:about=""',
      '      xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">',
      "      <Iptc4xmpExt:DigitalSourceType>",
      "        http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
      "      </Iptc4xmpExt:DigitalSourceType>",
      "    </rdf:Description>",
      "  </rdf:RDF>",
      "</x:xmpmeta>",
    ].join("\n");

    // Should not throw; with processEntities: false the parse succeeds
    // and DST is found as a text node.
    const result = parseDigitalSourceType(xml);
    expect(result.uri).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    );
  });

  it("returns null for non-string input at runtime", () => {
    // TypeScript would catch this at compile time, but runtime safety matters.
    expect(parseDigitalSourceType(null as unknown as string)).toEqual({
      uri: null,
      label: null,
    });
    expect(parseDigitalSourceType(undefined as unknown as string)).toEqual({
      uri: null,
      label: null,
    });
  });
});

describe("DIGITAL_SOURCE_TYPE_LABELS", () => {
  it("has expected entries", () => {
    expect(
      DIGITAL_SOURCE_TYPE_LABELS[
        "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"
      ],
    ).toBe("digital capture");
    expect(
      DIGITAL_SOURCE_TYPE_LABELS[
        "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
      ],
    ).toBe("AI-generated media");
  });

  it("covers all IPTC Digital Source Type URIs", () => {
    const uris = [
      "digitalCapture",
      "negativeFilm",
      "positiveFilm",
      "scannedImage",
      "screenCapture",
      "screenRecording",
      "trainedAlgorithmicMedia",
      "compositeSynthetic",
      "composite",
      "virtualRecording",
      "dataDrivenMedia",
    ];

    for (const code of uris) {
      const fullUri = `http://cv.iptc.org/newscodes/digitalsourcetype/${code}`;
      expect(DIGITAL_SOURCE_TYPE_LABELS[fullUri]).toBeDefined();
      expect(typeof DIGITAL_SOURCE_TYPE_LABELS[fullUri]).toBe("string");
      expect(DIGITAL_SOURCE_TYPE_LABELS[fullUri].length).toBeGreaterThan(0);
    }
  });
});
