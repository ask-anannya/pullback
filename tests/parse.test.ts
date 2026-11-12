import { describe, expect, it } from "vitest";
import {
  classifyHazard,
  compareUpc,
  extractDateRanges,
  extractLots,
  extractSizes,
  extractUpcs,
  mergeParse,
  parseDeterministic,
  validGtin,
} from "@/recalls/parse";

describe("UPC extraction", () => {
  it("reads UPCs with spaces, dashes and keywords", () => {
    expect(extractUpcs("Windy Acres FRUITY TRAIL MIX 7 OZ UPC 0 82987 02016 5 WILMINGTON, OH")).toContain("082987020165");
    expect(extractUpcs("The UPC code for the bar is 8-57087-00303-1 and best by")).toContain("857087003031");
    expect(extractUpcs("Fisher Tex Mex Trail Mix 30 oz plastic jar UPC 070690275941, 6 jars per case")).toEqual(["070690275941"]);
  });

  it("keeps 11-digit UPCs written without the check digit after a keyword", () => {
    expect(extractUpcs("Squirrel Brand Travelers Mix 16 oz can UPC 07223899166, 12 cans")).toEqual(["07223899166"]);
  });

  it("accepts bare 12 or 13 digit numbers only with a valid check digit", () => {
    expect(extractUpcs("item 070690275941 here")).toEqual(["070690275941"]);
    expect(extractUpcs("item 070690275942 here")).toEqual([]);
  });

  it("validates GTIN check digits", () => {
    expect(validGtin("070690275941")).toBe(true);
    expect(validGtin("085839073319")).toBe(true);
    expect(validGtin("4006381333931")).toBe(true); // EAN-13
    expect(validGtin("085839073318")).toBe(false);
  });

  it("compares UPCs exactly or with the check digit omitted", () => {
    expect(compareUpc("070690275941", "70690275941")).toBe("exact");
    expect(compareUpc("07223899166", "072238991663")).toBe("check_digit_omitted");
    expect(compareUpc("070690275941", "085839073319")).toBeNull();
  });
});

describe("lot extraction", () => {
  it("reads single lots and lists", () => {
    expect(extractLots("Item #02016 LOT# 022916-137 EXP DATE: 11/2016")).toEqual(["022916-137"]);
    expect(extractLots("Lot Code: 05M04210; Best By: April 22,2021")).toEqual(["05M04210"]);
    expect(extractLots("Lots: 3132585, 2652535, 0282570, 2302416.")).toEqual(["3132585", "2652535", "0282570", "2302416"]);
  });

  it("ignores text with no lot", () => {
    expect(extractLots("BEST BY 08/06/27")).toEqual([]);
    expect(extractLots("The lot Number is 111112.")).toEqual(["111112"]);
  });
});

describe("date ranges", () => {
  it("reads US numeric dates as single days", () => {
    expect(extractDateRanges("BEST BY 08/06/27")).toEqual([{ from: "2027-08-06", to: "2027-08-06" }]);
  });

  it("reads day/month-name/year", () => {
    expect(extractDateRanges("BEST BY 23/MAR/2027 GY")).toEqual([{ from: "2027-03-23", to: "2027-03-23" }]);
    expect(extractDateRanges("Expiry Date 17 APR 2018")).toEqual([{ from: "2018-04-17", to: "2018-04-17" }]);
  });

  it("reads 'on or before' as an open start", () => {
    expect(extractDateRanges("all best by dates on or before July 10, 2027")).toEqual([{ from: null, to: "2027-07-10" }]);
  });

  it("reads ranges with 'through' and 'to'", () => {
    expect(extractDateRanges("best by date 06/22/16 to 04/18/17")).toEqual([{ from: "2016-06-22", to: "2017-04-18" }]);
    expect(extractDateRanges("03JUL12 through 15JUN13")).toEqual([{ from: "2012-07-03", to: "2013-06-15" }]);
  });

  it("reads month/year as the whole month", () => {
    expect(extractDateRanges("EXP DATE: 11/2016")).toEqual([{ from: "2016-11-01", to: "2016-11-30" }]);
  });

  it("deduplicates repeated dates", () => {
    expect(extractDateRanges("BEST BY 02/05/27  BEST BY 02/05/27")).toHaveLength(1);
  });
});

describe("sizes and hazards", () => {
  it("reads sizes", () => {
    expect(extractSizes("Trail Mix, NET WT 8OZ (226g)")).toEqual(["8 oz", "226 g"]);
  });

  it("classifies hazards", () => {
    expect(classifyHazard("potential presence of Salmonella")).toBe("pathogen");
    expect(classifyHazard("Undeclared milk in snack mix products")).toBe("allergen");
    expect(classifyHazard("may contain pieces of metal")).toBe("foreign_material");
    expect(classifyHazard("Inaccurately declared nutrients")).toBe("other");
  });
});

describe("parse merge", () => {
  const rec = { product_description: "Fisher Tex Mex Trail Mix 30 oz plastic jar UPC 070690275941", code_info: "BEST BY 08/06/27", reason_for_recall: "Salmonella" };
  it("keeps regex identifiers over LLM ones and drops ungrounded LLM values", () => {
    const det = parseDeterministic(rec);
    const merged = mergeParse(
      det,
      {
        upcs: ["999999999999"],
        brands: ["Fisher", "Invented Brand"],
        product_names: ["Tex Mex Trail Mix"],
        sizes: ["30 oz"],
        lots: ["MADEUP1"],
        date_ranges: [{ from: "2030-01-01", to: "2030-01-01" }],
        hazard_type: "pathogen",
      },
      `${rec.product_description}\n${rec.code_info}`,
    );
    expect(merged.upcs).toEqual(["070690275941"]);
    expect(merged.brands).toEqual(["Fisher"]);
    expect(merged.lots).toEqual([]);
    expect(merged.dateRanges).toEqual([{ from: "2027-08-06", to: "2027-08-06" }]);
  });
});
