// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftEditor } from "./DraftEditor";
import type { DraftSnapshot } from "./draftClient";
const snapshot: DraftSnapshot = {
    status:"draf", draft_revision:1,
    document:{id:"draft-1",jenis:"surat_penawaran",locale:"en",mata_uang:"USD",nomor:null,tanggal:"2026-11-28",proyek:{nama:"Project",lokasi:"Location",klien:"Client"},pekerjaan:[
        {id:"a",uraian:"First",volume:1,satuan:"unit",harga_satuan:10,harga_satuan_minor:1000,jumlah:10,sumber_kutipan:"manual"},
        {id:"b",uraian:"Second",volume:1,satuan:"unit",harga_satuan:20,harga_satuan_minor:2000,jumlah:20,sumber_kutipan:"manual"},
    ],total_nominal:30,terbilang:"Thirty US dollars",butuh_konfirmasi:[]},
};
afterEach(cleanup);
describe("draft editor",()=>{
    it("sends only edited fields and preserves other unsaved edits after a save", async()=>{
        const mutate=vi.fn().mockResolvedValue(true);
        const view=render(<DraftEditor locale="en" snapshot={snapshot} mutate={mutate} busy={false}/>);
        fireEvent.change(screen.getAllByLabelText("Description")[0],{target:{value:"Unsaved first"}});
        fireEvent.change(screen.getAllByLabelText("Quantity")[1],{target:{value:"2"}});
        fireEvent.click(screen.getAllByRole("button",{name:"Save item"})[1]);
        await waitFor(()=>expect(mutate).toHaveBeenCalledWith({op:"update_line",item_id:"b",changes:{volume:"2"}}));
        view.rerender(<DraftEditor locale="en" snapshot={{...snapshot,draft_revision:2,document:{...snapshot.document,pekerjaan:[snapshot.document.pekerjaan[0],{...snapshot.document.pekerjaan[1],volume:2}]}}} mutate={mutate} busy={false}/>);
        expect((screen.getAllByLabelText("Description")[0] as HTMLInputElement).value).toBe("Unsaved first");
        expect((screen.getAllByLabelText("Quantity")[1] as HTMLInputElement).value).toBe("2");
    });
    it("preserves a rejected terms edit through a conflict refresh", async()=>{
        const mutate=vi.fn().mockResolvedValue(false);
        const view=render(<DraftEditor locale="en" snapshot={snapshot} mutate={mutate} busy={false}/>);
        fireEvent.change(screen.getByLabelText("Payment terms (optional)"),{target:{value:"Net 30"}});
        fireEvent.click(screen.getByRole("button",{name:"Save terms"}));
        await waitFor(()=>expect(mutate).toHaveBeenCalled());
        view.rerender(<DraftEditor locale="en" snapshot={{...snapshot,draft_revision:2,document:{...snapshot.document,syarat_pembayaran:"Net 14"}}} mutate={mutate} busy={false}/>);
        expect((screen.getByLabelText("Payment terms (optional)") as HTMLTextAreaElement).value).toBe("Net 30");
    });
});
