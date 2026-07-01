# Argyle Theatre Poster Act Classification

## Problem Statement
The Argyle Theatre Collection contains scanned posters from approximately 1890-1930, featuring details of performing acts. Currently, librarians manually read each poster and enter performer categories (e.g. Comedians, Singing, Dance) into metadata fields so researchers can search the catalogue by act type. This manual process is slow and labour-intensive. The goal of this project is to develop an automated method to classify act descriptions extracted from historical theatre posters into standardised categories, speeding up the cataloguing process and enabling future application to undigitised posters.

## Categories
We adopted the library's existing taxonomy of 14 categories rather than inventing our own, ensuring direct compatibility with their cataloguing system:

| Category | Seed Keywords |
| :--- | :--- |
| **Comedians** | comedian, comedienne, comic, burlesque, slapstick, knockabout, clown, serio-comic |
| **Singing** | vocalist, singer, soprano, ballad, vocal, songster, warbler, chorus, operatic |
| **Dance** | dancer, dancing, danseuse, ballet, skirt dancer, boot dancer |
| **Musicians** | pianist, harpist, banjo, concertina, violinist, instrumentalist |
| **Jugglers** | juggler, juggling |
| **Acrobats** | acrobat, equilibrist, tumbler, contortionist, horizontal bar, trapeze |
| **Gymnasts** | gymnast, gymnastics, horizontal bar |
| **Tightrope walking** | tightrope, walking, wire, rope |
| **Magic** | conjurer, wizard, magician, illusionist, necromancer, second sight |
| **Motion pictures** | bioscope, motion pictures, moving pictures, film, animated, cinematograph |
| **Animal trainers** | animal, dog, cockatoo, performing animals |
| **Male impersonators** | impersonator, male impersonator |
| **Stunt performers** | cycling, bicycle, novelty, stunt, cyclist, rocket |
| **Imitation** | mimic, imitator, delineator, impersonation, character studies |

## Method

### 4.1 Text Preprocessing
The raw poster text required cleaning before classification. The preprocessing pipeline has four stages:
* **Noise removal:** Poster descriptions contain promotional language irrelevant to act classification. We remove phrases such as "for one week only," "first appearance in Birkenhead," "the celebrated/renowned/popular," quoted show titles, and performer honorifics (Mr/Mrs/Miss). This is done using regular expression pattern matching.
* **Normalisation:** Text is converted to lowercase and punctuation is removed.
* **Stemming:** Words are reduced to their root forms using the Porter Stemmer (e.g. "comedian," "comedians," "comedienne" all become "comedian"). This is critical because Victorian act descriptions use many grammatical variants of the same word.
* **First-term boosting:** The first word of each description is duplicated to give it more weight. This reflects the Victorian poster convention where the primary skill is listed first (e.g. "Comedian and Dancer").

### 4.2 TF-IDF Vectorization
Both the cleaned act descriptions and the category seed descriptions are transformed into numerical vectors using Term Frequency-Inverse Document Frequency (TF-IDF).
* Unigrams and bigrams (single words and two-word phrases) are used to capture terms like "comic vocalist" as a single feature.
* Maximum 500 features to avoid noise from rare terms.
* English stopwords are removed.

### 4.3 Cosine Similarity Classification (Primary Method)
Each category is represented by a seed description. For each act, we compute the cosine similarity between its TF-IDF vector and every category's TF-IDF vector. 
* **Multi-label assignment:** Each act is assigned up to 2 categories, with all categories scoring above a threshold of 0.05. The cap of 2 labels prevents noise from weak secondary matches.

### 4.4 Fuzzy String Matching (Fallback Method)
Approximately 15% of acts receive no cosine similarity score above the threshold. For these acts, we apply fuzzy string matching using the `rapidfuzz` library.
* Fuzzy matching compares each act description against every keyword in every category using partial ratio matching. 
* Acts are assigned to categories scoring above a fuzzy threshold of 60. If no category exceeds this threshold, the act is assigned to its best-scoring category rather than being left unclassified.

## Validation
Classification was validated at the poster level against the library's existing metadata. For each poster:
1. All predicted categories across its acts were aggregated into a set.
2. The library's subject tags for that poster were compared directly against predicted categories.
3. Precision, recall, and F1 score were calculated per category.

We report weighted-average F1 as the primary metric, which weights each category's F1 by how frequently it appears in the ground truth.

---

## Results

### Validation Results (Gemini)

**Per Category Validations:**

| Category | F1 | Precision | Recall | TP | FP | FN |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Comedians | 100.0% | 100.0% | 100.0% | 24 | 0 | 0 |
| Singing | 90.9% | 90.9% | 90.9% | 20 | 2 | 2 |
| Dance | 81.1% | 71.4% | 93.8% | 15 | 6 | 1 |
| Jugglers | 80.0% | 66.7% | 100.0% | 2 | 1 | 0 |
| Motion pictures | 80.0% | 66.7% | 100.0% | 8 | 4 | 0 |
| Musicians | 69.6% | 57.1% | 88.9% | 8 | 6 | 1 |
| Animal trainers | 47.1% | 30.8% | 100.0% | 4 | 9 | 0 |
| Male impersonators | 44.4% | 28.6% | 100.0% | 2 | 5 | 0 |
| Acrobats | 33.3% | 20.0% | 100.0% | 3 | 12 | 0 |
| Gymnasts | 25.0% | 14.3% | 100.0% | 1 | 6 | 0 |
| Tightrope walking | 18.2% | 10.0% | 100.0% | 1 | 9 | 0 |
| Magic | 16.7% | 9.1% | 100.0% | 1 | 10 | 0 |
| Stunt performers | 16.7% | 9.1% | 100.0% | 1 | 10 | 0 |
| Imitation | 12.5% | 6.7% | 100.0% | 1 | 14 | 0 |

**Overall Weighted Results (Gemini):**
* **Weighted Precision:** 73.8%
* **Weighted Recall:** 95.8%
* **Weighted F1:** 79.9%

### Validation Results (Qwen)

**Per Category Validations:**

| Category | F1 | Precision | Recall | TP | FP | FN |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Singing | 85.1% | 100.0% | 74.1% | 20 | 0 | 7 |
| Comedians | 82.4% | 100.0% | 70.0% | 21 | 0 | 9 |
| Jugglers | 66.7% | 66.7% | 66.7% | 2 | 1 | 1 |
| Motion Pictures | 66.7% | 75.0% | 60.0% | 6 | 2 | 4 |
| Dance | 62.9% | 78.6% | 52.4% | 11 | 3 | 10 |
| Animal Trainers | 54.6% | 42.9% | 75.0% | 3 | 4 | 1 |
| Musicians | 44.4% | 37.5% | 54.6% | 6 | 10 | 5 |
| Acrobats | 14.3% | 9.1% | 33.3% | 1 | 10 | 2 |
| Gymnasts | 0.00% | 0.00% | 0.00% | 0 | 4 | 1 |
| Imitation | 0.00% | 0.00% | 0.00% | 0 | 9 | 0 |
| Magic | 0.00% | 0.00% | 0.00% | 0 | 4 | 1 |
| Male impersonators | 0.00% | 0.00% | 0.00% | 0 | 3 | 2 |
| Stunt performers | 0.00% | 0.00% | 0.00% | 0 | 3 | 2 |
| Tightrope walking | 0.00% | 0.00% | 0.00% | 0 | 2 | 1 |

**Overall Weighted Results (Qwen):**
* **Weighted Precision:** 59.8%
* **Weighted Recall:** 76.2%
* **Weighted F1:** 65.9%
