use std::env;
use std::path::PathBuf;

fn main() {
    let crate_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let config_path = PathBuf::from(&crate_dir).join("cbindgen.toml");
    let config =
        cbindgen::Config::from_file(&config_path).expect("Unable to find or parse cbindgen.toml");

    let out_file = PathBuf::from(&crate_dir).join("voicenote_core.h");

    cbindgen::Builder::new()
        .with_crate(crate_dir)
        .with_config(config)
        .generate()
        .expect("Unable to generate C bindings")
        .write_to_file(out_file);

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/errors.rs");
    println!("cargo:rerun-if-changed=cbindgen.toml");
}
