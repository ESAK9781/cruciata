// Embeds the game icon into the Windows executable (best effort: a missing
// resource compiler only costs the icon, never the build).
fn main() {
    println!("cargo:rerun-if-changed=../../packaging/icons/cruciata.ico");
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("../../packaging/icons/cruciata.ico");
        res.set("ProductName", "Cruciata");
        res.set("FileDescription", "Cruciata");
        if let Err(e) = res.compile() {
            println!("cargo:warning=could not embed the Windows icon: {e}");
        }
    }
}
