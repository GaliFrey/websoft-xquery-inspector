for $elem in subdivisions
where IsHierChildOrSelf($elem/id, 6327975429225669221)
order by $elem/Hier()
return $elem/Fields('id', 'name')
