USE PLANILLA;
GO

-- 1. Crear la tabla si no existe
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'EMPLEADOS_ARCHIVADOS')
BEGIN
    CREATE TABLE EMPLEADOS_ARCHIVADOS (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        MongoId NVARCHAR(50),
        Nombre NVARCHAR(100),
        Apellido NVARCHAR(100),
        Sueldo DECIMAL(18,2),
        Departamento NVARCHAR(100),
        Motivo NVARCHAR(255),
        Telefono NVARCHAR(50),
        Cargo NVARCHAR(100),
        Tipo NVARCHAR(50),
        EmpleadoOriginalId NVARCHAR(50),
        FechaArchivado DATE,
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE()
    );
END
GO

-- 2. Insertar los datos de los empleados del JSON de Mongo
INSERT INTO EMPLEADOS_ARCHIVADOS (
    MongoId, Nombre, Apellido, Sueldo, Departamento, 
    Motivo, Telefono, Cargo, Tipo, EmpleadoOriginalId, 
    FechaArchivado, CreatedAt, UpdatedAt
)
VALUES 
-- Primer Empleado: Anahy Guadalupe
(
    '6957f0046b93254720f10dd4', 
    'ANAHY GUADALUPE', 
    'GOMEZ GARCIA', 
    1350.00, 
    'Diseño Gráfico', 
    'Termino contrato', 
    '+51 989728531', 
    'Diseñador', 
    'PLANILLA', 
    '68c894041518a1ddfda94bfa', 
    '2026-01-02', 
    '2026-01-02 16:19:16.387', 
    '2026-01-02 16:19:16.387'
),

-- Segundo Empleado: Katherine Laura Elena
(
    '6957f00a6b93254720f10de0', 
    'KATHERINE LAURA ELENA', 
    'CULQUI CASTRO', 
    1130.00, 
    'MARKETING', 
    'Termino contrato', 
    '+51 952875480', 
    'Especialista en Marketing', 
    'PLANILLA', 
    '68c894e41518a1ddfda94bfe', 
    '2026-01-02', 
    '2026-01-02 16:19:22.084', 
    '2026-01-02 16:19:22.084'
);
GO

-- Verificar los datos insertados
SELECT * FROM EMPLEADOS_ARCHIVADOS;
GO
