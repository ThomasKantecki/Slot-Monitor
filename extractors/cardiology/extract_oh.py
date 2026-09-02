"""Convenience entry point for Orlando Health Cardiology extraction."""
import sys
from extract_system import main

if __name__ == "__main__":
    sys.argv[1:1] = ["--system", "oh"]
    main()
