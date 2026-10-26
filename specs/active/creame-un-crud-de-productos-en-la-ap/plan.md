# Plan creame-un-crud-de-productos-en-la-ap — creame un CRUD de productos en

**estado:** propuesta para revisión
**sesión:** s-742afb90

1. Explorar la estructura del proyecto para identificar el stack tecnológico (framework, lenguaje, ORM, base de datos), convenciones de carpetas, patrones existentes (rutas, controladores, servicios, modelos, validación, tests) y cualquier configuración de migraciones o seeds.
2. Revisar si ya existe un modelo/entidad `Product` o similar, y examinar su esquema de campos, relaciones, índices y restricciones.
3. Verificar la existencia de migraciones pendientes o necesarias para la tabla de productos; si no hay, diseñar la migración inicial (campos típicos: id, sku, name, description, price, stock, is_active, timestamps, soft deletes si procede).
4. Identificar cómo se definen las rutas (RESTful, prefijos, middlewares de auth/permiso) y añadir las rutas CRUD (`index`, `store`, `show`, `update`, `destroy`) bajo el recurso `products`.
5. Crear o actualizar el controlador `ProductController` con los métodos CRUD, aplicando validación de entrada (request classes o validadores inline), autorización (policies/gates) y manejo de errores consistente con el resto de la app.
6. Implementar la lógica de negocio en un servicio/repositorio si la arquitectura lo usa, separando consultas (listado con filtros/paginación/ordenación, búsqueda) y comandos (crear, actualizar, eliminar, restaurar si soft delete).
7. Definir resources/transformers/DTOs para serializar la respuesta JSON de forma uniforme (incluyendo relaciones si procede) y documentar los campos expuestos.
8. Añadir tests automatizados: unitarios para validaciones y servicios, de integración/feature para cada endpoint (200, 201, 404, 422, 403), cubriendo happy path y edge cases.
9. Verificar que la UI/cliente (si existe en el repo) tenga componentes/listados/formularios para consumir el nuevo CRUD; si no, documentar la API (OpenAPI/Swagger) para que el frontend pueda integrarse.
10. Ejecutar linter, formateador y suite de tests completa para asegurar que no se rompe nada; revisar migraciones en entorno de staging antes de merge.
11. Preparar checklist de revisión humana: migraciones, rutas, controlador, validación, autorización, serialización, tests, documentación, rendimiento (índices, N+1), seguridad (mass assignment, rate limiting).

¿Pasamos a **Build**?
