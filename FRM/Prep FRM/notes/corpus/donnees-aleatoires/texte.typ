#import "/_corpus-titres.typ": voir

La brique de base : `n` tirages aléatoires d'une #voir("loi-normale"), ou d'une #voir("loi-de-student") pour des queues plus épaisses (pertes extrêmes plus fréquentes). Les autres briques y prennent leur hasard : #voir("trajectoires-prix"), #voir("monte-carlo").

```python
from briques.donnees_aleatoires import generate_random_data

z = generate_random_data(1000)  # loi normale centrée réduite
pertes = generate_random_data(1000, distribution="student", df=4)
```

`seed=1` (un nombre entier) redonne les mêmes tirages à chaque exécution.