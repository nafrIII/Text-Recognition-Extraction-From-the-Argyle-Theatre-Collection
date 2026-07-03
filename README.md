# Text Recognition & Extraction: Argyle Theatre Collection

## Project Overview

The Argyle Theatre Collection contains scanned historical posters from approximately 1890-1930, detailing various performing acts. Currently, librarians must manually read each poster to catalogue information such as act types (e.g., Comedians, Singing, Dance), performers, and dates. This manual process is highly labour-intensive. 

This project aims to automate the extraction and classification of this information using Large Language Models (LLMs) such as Gemini and Qwen. By developing automated methods to transcribe text from images and classify act descriptions into standardised categories, the project speeds up the cataloguing process and enables rich, semantic search over the theatre's archives.

## Repository Structure

* **`data/`**: Contains CSV datasets including the manual ground-truth extractions as well as the automated extraction results from Gemini and Qwen.
* **`deliverables/`**: Contains project presentations and poster PDFs summarizing the research and findings.
* **`deployment_examples/`**: Visual mockups of the User and Staff interfaces for the application.
* **`outputs/`**: Generated outputs and logs from the Gemini and Qwen model runs.
* **`src/`**: The main source code directory, divided into three key components:
  * **`LLM_image_extraction/`**: Code for processing the raw poster images and extracting text and layout information using LLMs.
  * **`LLM_type_extraction/`**: Jupyter notebooks (`type_extraction_gemini.ipynb`, `type_extraction_qwen.ipynb`) that classify the extracted act descriptions into 14 standardised library categories using TF-IDF, cosine similarity, and fuzzy string matching. See its inner `README.md` for a detailed methodology and validation results.
  * **`website_deployment/`**: A deployable web application built with Python (`app.py`), SQLite, and Vanilla JS/CSS. It provides a semantic search interface for users to explore the posters and a staff interface to manage the archives.

## Running the Web Application Preview
The repository includes a web deployment that allows you to interact with the dataset.

1. Navigate to the website deployment directory:
   ```bash
   cd src/website_deployment
   ```
2. Start the Python server:
   ```bash
   python app.py
   ```
3. Open your browser and navigate to:
   * **User Interface**: `http://127.0.0.1:8000/index.html`
   * **Staff Interface**: `http://127.0.0.1:8000/staff.html`

## Methodology Highlight
The act classification pipeline uses a robust methodology to handle the noisy, historical text:
1. **Preprocessing**: Normalisation, noise removal, and stemming of Victorian grammatical variants.
2. **TF-IDF & Cosine Similarity**: Matching acts to seed keywords for 14 library-approved categories.
3. **Fuzzy Matching Fallback**: Catching edge cases using partial ratio matching for acts that fall below the similarity threshold.

*(For full validation results comparing Gemini and Qwen, please refer to `src/LLM_type_extraction/README.md`)*.