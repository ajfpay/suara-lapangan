import { describe, expect, it } from "vitest";
import {
    amountInWords,
    extractNumbersWithContext,
    terbilang,
} from "./words";

describe("words - number formatting and extraction", () => {
    it("handles amountInWords cents rollover", () => {
        expect(amountInWords(12.999)).toBe("Thirteen US dollars");
        expect(amountInWords(12.5)).toBe("Twelve US dollars and fifty cents");
        expect(amountInWords(100)).toBe("One hundred US dollars");
    });

    it("handles large terbilang scale up to trillions", () => {
        expect(terbilang(1500000)).toBe("Satu juta lima ratus ribu rupiah");
        expect(terbilang(1500000000)).toBe("Satu miliar lima ratus juta rupiah");
        expect(terbilang(2000000000000)).toBe("Dua triliun rupiah");
    });

    it("extracts dot decimal numbers in Indonesian correctly", () => {
        const nums = extractNumbersWithContext("harganya 2.5 juta rupiah", "id");
        expect(nums.some((n) => n.value === 2.5)).toBe(true);
    });

    it("does not merge subsequent numbers into decimal fraction", () => {
        const nums = extractNumbersWithContext("butuh dua koma lima 12 sak semen", "id");
        const vals = nums.map((n) => n.value);
        expect(vals).toContain(2.5);
        expect(vals).toContain(12);
        expect(vals).not.toContain(2.512);
    });

    it("distinguishes thousands grouping by locale", () => {
        const enNums = extractNumbersWithContext("total is 1,500 dollars", "en");
        expect(enNums.some((n) => n.value === 1500)).toBe(true);

        const idNums = extractNumbersWithContext("totalnya 150.000 rupiah", "id");
        expect(idNums.some((n) => n.value === 150000)).toBe(true);
    });
});
