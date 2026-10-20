var seccionActual = "acceso";
var idGestorActual = null;
var token = null; // JWT que devuelve el login; se añade a todas las peticiones a /api
var nombreGestorActual = null;
var idRecursoActual = null; // null = recurso nuevo
var conexionWS = null;

var listaModelos = [];
var listaCategorias = [];
var listaUbicaciones = [];

// P3 P3 P3

var ID_AREA = 18; // Urología
var URL_MINISTERIO = "https://undefined.ua.es/telemedicina/api/datos";
var AREAS = {
    1: "Alergología", 2: "Anestesiología", 3: "Cardiología", 4: "Cirugía General",
    5: "Dermatología", 6: "Aparato Digestivo", 7: "Endocrinología", 8: "Ginecología",
    9: "Hematología", 10: "Medicina Interna", 11: "Neumología", 12: "Neurología",
    13: "Oftalmología", 14: "Oncología", 15: "Pediatría", 16: "Psiquiatría",
    17: "Traumatología", 18: "Urología"
};

function cambiarSeccion(seccion){
    document.getElementById(seccionActual).hidden = true;
    document.getElementById(seccion).hidden = false;
    seccionActual = seccion;
}

function salir() {
    if (conexionWS) {
        conexionWS.close();
        conexionWS = null;
    }
    idGestorActual = null;
    token = null;
    document.getElementById("tbody_recursos").innerHTML = "";
    document.getElementById("tbody_avisos").innerHTML = "";
    document.getElementById("tbody_ranking").innerHTML = "";
    cambiarSeccion('acceso');
}

function getNombreModelo(id) {
    for (var i = 0; i < listaModelos.length; i++) {
        if (listaModelos[i].id == id) return listaModelos[i].nombre;
    }
    return "-";
}

function getNombreCategoria(id) {
    for (var i = 0; i < listaCategorias.length; i++) {
        if (listaCategorias[i].id == id) return listaCategorias[i].nombre;
    }
    return "-";
}

// La categoría no está en el recurso: se obtiene a través de su modelo
function getCategoriaDeModelo(idModelo) {
    for (var i = 0; i < listaModelos.length; i++) {
        if (listaModelos[i].id == idModelo) return listaModelos[i].categoria;
    }
    return null;
}

function getNombreUbicacion(id) {
    for (var i = 0; i < listaUbicaciones.length; i++) {
        if (listaUbicaciones[i].id == id) return listaUbicaciones[i].nombre;
    }
    return "-";
}

function getNombreEstado(val) {
    if (val == 0) return "Operativo";
    if (val == 1) return "De baja o defectuoso";
    if (val == 2) return "En mantenimiento";
    return "-";
}

function formatearFecha(fecha) {
    if (!fecha) return "-";
    var d = new Date(fecha);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString();
}

// Añade el token a la URL, con ? o con & según si la URL ya tiene parámetros
function conToken(url) {
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "token=" + token;
}

// ---------- Desplegables ----------

// Rellena un <select> con una lista de objetos {id, nombre}.
// Si textoTodos no es null, añade primero una opción "Todos" con valor 0.
function rellenarSelect(idSelect, lista, textoTodos) {
    var select = document.getElementById(idSelect);
    select.innerHTML = "";
    if (textoTodos != null) {
        select.innerHTML += "<option value='0'>" + textoTodos + "</option>";
    }
    for (var i = 0; i < lista.length; i++) {
        select.innerHTML += "<option value='" + lista[i].id + "'>" + lista[i].nombre + "</option>";
    }
}

// Rellena el select de modelos solo con los de la categoría elegida
function filtrarModelos(idSelectCategoria, idSelectModelo, textoTodos) {
    var idCategoria = document.getElementById(idSelectCategoria).value;
    var modelosFiltrados = [];
    for (var i = 0; i < listaModelos.length; i++) {
        if (idCategoria == 0 || listaModelos[i].categoria == idCategoria) {
            modelosFiltrados.push(listaModelos[i]);
        }
    }
    rellenarSelect(idSelectModelo, modelosFiltrados, textoTodos);
}

function cargarListados() {
    rest.get(conToken("/api/categorias"), function(estado, respuesta) {
        if (estado != 200) return;
        listaCategorias = respuesta;
        rellenarSelect("home_categoria", listaCategorias, "Todas");
        rellenarSelect("rec_categoria", listaCategorias, null);

        rest.get(conToken("/api/modelos"), function(estado, respuesta) {
            if (estado != 200) return;
            listaModelos = respuesta;
            filtrarModelos("home_categoria", "home_modelo", "Todos");
            filtrarModelos("rec_categoria", "rec_modelo", null);
        });
    });
    rest.get(conToken("/api/ubicaciones"), function(estado, respuesta) {
        if (estado != 200) return;
        listaUbicaciones = respuesta;
        rellenarSelect("home_ubicacion", listaUbicaciones, "Todas");
        rellenarSelect("rec_ubicacion", listaUbicaciones, null);
    });
}

// ---------- Acceso y datos del gestor ----------

function login() {
    var gestor = {
        login: document.getElementById("usuario").value,
        password: document.getElementById("password").value
    };

    rest.post("/api/gestores/login", gestor, function(estado, respuesta) {
        if(estado == 200) {
            idGestorActual = respuesta.id;
            token = respuesta.token;
            document.getElementById("password").value = "";
            cambiarSeccion('home');
            // Los desplegables se cargan ahora porque esos servicios ya necesitan token
            cargarListados();
            obtenerDatosYBienvenida();
            cargarRanking();
        } else {
            alert("Credenciales incorrectas.");
        }
    });
}

function obtenerDatosYBienvenida() {
    rest.get(conToken("/api/gestores/" + idGestorActual), function(estado, respuesta) {
        if (estado != 200) return;
        nombreGestorActual = respuesta.nombre + " " + respuesta.apellidos;
        document.getElementById("texto_bienvenida").innerHTML = "Bienvenido/a " + nombreGestorActual;

        if (conexionWS) {
            // Ya conectado (p.ej. tras editar datos): actualizar el nombre en el servidor WS
            identificarWS();
            return;
        }

        conexionWS = new WebSocket("ws://localhost:4445", "avisos");
        conexionWS.addEventListener("open", identificarWS);
        conexionWS.addEventListener("message", function(msg) {
            var aviso = JSON.parse(msg.data);
            var tbody = document.getElementById("tbody_avisos");
            // La clase (aviso-reserva, aviso-recurso, aviso-resenya) da el color en estilos.css
            var fila = "<tr class='aviso-" + aviso.tipo + "'>"
                + "<td>" + formatearFecha(aviso.fecha) + "</td>"
                + "<td>" + aviso.origen + "</td>"
                + "<td>" + aviso.texto + "</td>"
                + "</tr>";
            tbody.innerHTML += fila;
        });
    });
}

function identificarWS() {
    conexionWS.send(JSON.stringify({
        operacion: "identificar",
        rol: "gestor",
        id: idGestorActual,
        nombre: nombreGestorActual
    }));
}

function registrarUsuario() {
    var gestor = {
        nombre: document.getElementById("reg_nombre").value,
        apellidos: document.getElementById("reg_apellidos").value,
        usuario: document.getElementById("reg_usuario").value,
        password: document.getElementById("reg_password").value
    }
    if (!gestor.nombre || !gestor.apellidos || !gestor.usuario || !gestor.password) {
        alert("Rellena todos los campos.");
        return;
    }
    rest.post("/api/gestores", gestor, function (estado, respuesta) {
        if (estado == 201) {
            alert("Gestor añadido correctamente a la base de datos.");
            cambiarSeccion('acceso');
        } else {
            alert("No se ha podido registrar el gestor. Es posible que el login ya exista.")
        }
    });
}

function editarDatos(){
    rest.get(conToken("/api/gestores/" + idGestorActual), function(estado, gestor) {
        if (estado != 200) {
            alert("No se han podido cargar los datos del gestor.");
            return;
        }
        document.getElementById("mod_nombre").value = gestor.nombre;
        document.getElementById("mod_apellidos").value = gestor.apellidos;
        document.getElementById("mod_usuario").value = gestor.usuario;
        document.getElementById("mod_password").value = "";
        cambiarSeccion('editarDatos');
    });
}

function modificarUsuario() {
    var gestor = {
        nombre: document.getElementById("mod_nombre").value,
        apellidos: document.getElementById("mod_apellidos").value,
        usuario: document.getElementById("mod_usuario").value,
        password: document.getElementById("mod_password").value
    }
    if (!gestor.nombre || !gestor.apellidos || !gestor.usuario) {
        alert("Nombre, apellidos y login son obligatorios.");
        return;
    }
    rest.put(conToken("/api/gestores/" + idGestorActual), gestor, function(estado, respuesta) {
        if (estado == 200) {
            alert("Se han actualizado correctamente los datos.");
            obtenerDatosYBienvenida();
            cambiarSeccion('home');
        } else {
            alert("No se han actualizado los datos. Es posible que el login ya exista.")
        }
    });
}

// ---------- Listado de recursos ----------

function mostrarRecursos() {
    var categoria = document.getElementById("home_categoria").value;
    var modelo = document.getElementById("home_modelo").value;
    var ubicacion = document.getElementById("home_ubicacion").value;
    var estadoVal = document.getElementById("home_estado").value;

    var url = "/api/recursos?";
    if (categoria != "0") url += "categoria=" + categoria + "&";
    if (modelo != "0") url += "modelo=" + modelo + "&";
    if (ubicacion != "0") url += "ubicacion=" + ubicacion + "&";
    if (estadoVal != "-1") url += "estado=" + estadoVal + "&";

    rest.get(conToken(url), function(estado, respuesta) {
        if (estado == 200) {
            var tbody = document.getElementById("tbody_recursos");
            tbody.innerHTML = "";
            for (var i = 0; i < respuesta.length; i++) {
                var r = respuesta[i];
                var fila = "<tr>"
                    + "<td>" + r.numero_serie + "</td>"
                    + "<td>" + getNombreCategoria(getCategoriaDeModelo(r.modelo)) + "</td>"
                    + "<td>" + getNombreModelo(r.modelo) + "</td>"
                    + "<td>" + getNombreUbicacion(r.ubicacion) + "</td>"
                    + "<td>" + getNombreEstado(r.estado) + "</td>"
                    + "<td>"
                    + "<button onclick=\"abrirRecurso(" + r.id + ")\">Abrir</button>"
                    + "<button class='btn-danger' onclick=\"borrarRecurso(" + r.id + ", this)\">X</button>"
                    + "</td>"
                    + "</tr>";
                tbody.innerHTML += fila;
            }
        } else {
            alert("No se han podido cargar los recursos.");
        }
    });
}

function borrarRecurso(idRecurso, boton) {
    var fila = boton.parentNode.parentNode;
    var numSerie = fila.cells[0].innerText;
    if (confirm("¿Estás seguro de que deseas eliminar el recurso con Nº Serie: " + numSerie + "?")) {
        rest.delete(conToken("/api/recursos/" + idRecurso), function(estado, respuesta) {
            if (estado == 200) {
                fila.parentNode.removeChild(fila);
            } else {
                alert("Error al borrar el recurso.");
            }
        });
    }
}

// ---------- Ficha de recurso (nuevo o existente) ----------

function nuevoRecurso() {
    idRecursoActual = null;
    document.getElementById("rec_categoria").selectedIndex = 0;
    filtrarModelos("rec_categoria", "rec_modelo", null);
    document.getElementById("rec_num_serie").value = "";
    document.getElementById("rec_ubicacion").selectedIndex = 0;
    document.getElementById("rec_estado").value = "0";
    // Un recurso nuevo aún no tiene reservas ni reseñas
    document.getElementById("rec_historial").hidden = true;
    cambiarSeccion('recurso');
}

function abrirRecurso(idRecurso) {
    rest.get(conToken("/api/recursos/" + idRecurso), function(estado, recurso) {
        if (estado == 200) {
            idRecursoActual = recurso.id;
            document.getElementById("rec_categoria").value = getCategoriaDeModelo(recurso.modelo);
            filtrarModelos("rec_categoria", "rec_modelo", null);
            document.getElementById("rec_modelo").value = recurso.modelo;
            document.getElementById("rec_num_serie").value = recurso.numero_serie;
            document.getElementById("rec_ubicacion").value = recurso.ubicacion;
            document.getElementById("rec_estado").value = recurso.estado;
            document.getElementById("rec_historial").hidden = false;
            cargarTablaReservas(recurso.id);
            cargarTablaResenyas(recurso.id);
            cambiarSeccion('recurso');
        } else {
            alert("Error al cargar el recurso. El servidor no lo encuentra.");
        }
    });
}

function guardarRecurso() {
    var recurso = {
        modelo: document.getElementById("rec_modelo").value,
        numero_serie: document.getElementById("rec_num_serie").value.trim(),
        ubicacion: document.getElementById("rec_ubicacion").value,
        estado: document.getElementById("rec_estado").value
    };
    if (!recurso.numero_serie || !recurso.modelo) {
        alert("Indica el modelo y el número de serie.");
        return;
    }

    if (idRecursoActual == null) {
        rest.post(conToken("/api/recursos"), recurso, function(estado, nuevo) {
            if (estado == 201) {
                alert("Recurso añadido correctamente.");
                if (conexionWS) {
                    conexionWS.send(JSON.stringify({
                        operacion: "recursoCreado",
                        nombreCategoria: getNombreCategoria(getCategoriaDeModelo(nuevo.modelo)),
                        nombreModelo: getNombreModelo(nuevo.modelo),
                        numeroSerie: nuevo.numero_serie
                    }));
                }
                mostrarRecursos();
                cambiarSeccion('home');
            } else {
                alert("El recurso no se ha podido añadir.");
            }
        });
    } else {
        rest.put(conToken("/api/recursos/" + idRecursoActual), recurso, function(estado, respuesta) {
            if (estado == 200) {
                alert("Recurso actualizado.");
                mostrarRecursos();
                cambiarSeccion('home');
            } else {
                alert("El recurso no se ha actualizado.");
            }
        });
    }
}

function cargarTablaReservas(idRecurso) {
    var tbody = document.getElementById("tabla_reservas_body");
    tbody.innerHTML = "";
    rest.get(conToken("/api/recursos/" + idRecurso + "/reservas"), function(estado, reservas) {
        if (estado != 200) return;
        reservas.forEach(function(r) {
            // La fila se crea ya para mantener el orden; el nombre se rellena al llegar
            var fila = tbody.insertRow();
            // El color de cada estado está en estilos.css
            if (r.fecha_fin) {
                fila.className = "reserva-finalizada";
            } else if (r.fecha_inicio) {
                var horasTranscurridas = (new Date() - new Date(r.fecha_inicio)) / (1000 * 60 * 60);
                fila.className = horasTranscurridas > r.horas_estimadas ? "reserva-excedida" : "reserva-en-uso";
            } else {
                fila.className = "reserva-pendiente";
            }
            fila.innerHTML = "<td>-</td>"
                + "<td>" + r.horas_estimadas + "</td>"
                + "<td>" + formatearFecha(r.fecha_peticion) + "</td>"
                + "<td>" + formatearFecha(r.fecha_inicio) + "</td>"
                + "<td>" + formatearFecha(r.fecha_fin) + "</td>";
            rest.get(conToken("/api/sanitarios/" + r.sanitario), function(st, san) {
                fila.cells[0].innerText = (st == 200) ? (san.nombre + " " + san.apellidos) : "Desconocido";
            });
        });
    });
}

function cargarTablaResenyas(idRecurso) {
    var tbody = document.getElementById("tabla_resenas_body");
    tbody.innerHTML = "";
    rest.get(conToken("/api/recursos/" + idRecurso + "/resenyas"), function(estado, resenyas) {
        if (estado != 200) return;
        resenyas.forEach(function(r) {
            var fila = tbody.insertRow();
            fila.innerHTML = "<td>" + formatearFecha(r.fecha) + "</td><td>-</td><td>" + r.valor + "</td><td>" + r.descripcion + "</td>";
            rest.get(conToken("/api/sanitarios/" + r.sanitario), function(st, san) {
                fila.cells[1].innerText = (st == 200) ? (san.nombre + " " + san.apellidos) : "Desconocido";
            });
        });
    });
}

// ---------- Ministerio de Sanidad: envío de reservas y ranking ----------

// Fecha en formato YYYY-MM-DD (hora local, para que no cambie el día por UTC)
function fechaYMD(fecha) {
    if (!fecha) return null;
    var d = new Date(fecha);
    var mes = String(d.getMonth() + 1).padStart(2, "0");
    var dia = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mes + "-" + dia;
}

// Reúne todas las reservas del hospital con los servicios REST que ya existen
// (no hay uno que las devuelva todas): recursos -> reservas de cada recurso -> sanitario.
// Al terminar llama a cb(paquete), o a cb(null) si no se han podido obtener los recursos.
function construirPaquete(cb) {
    var paquete = { id_area: ID_AREA, fecha: fechaYMD(new Date()), datos: [] };

    rest.get(conToken("/api/recursos"), function(estado, recursos) {
        if (estado != 200) return cb(null);
        if (recursos.length == 0) return cb(paquete);

        // Peticiones que faltan por terminar: al principio una por recurso,
        // y al llegar las reservas de un recurso se suma una por reserva
        var pendientes = recursos.length;
        function terminar() {
            pendientes--;
            if (pendientes == 0) cb(paquete);
        }

        recursos.forEach(function(rec) {
            rest.get(conToken("/api/recursos/" + rec.id + "/reservas"), function(estado, reservas) {
                if (estado == 200) {
                    pendientes += reservas.length; // se suma antes de restar este recurso
                    reservas.forEach(function(r) {
                        rest.get(conToken("/api/sanitarios/" + r.sanitario), function(st, san) {
                            paquete.datos.push({
                                nombre: (st == 200) ? san.nombre : "Desconocido",
                                apellidos: (st == 200) ? san.apellidos : "",
                                categoria: getNombreCategoria(getCategoriaDeModelo(rec.modelo)),
                                horas_estimadas: r.horas_estimadas,
                                fec_pet: fechaYMD(r.fecha_peticion),
                                fec_ini: fechaYMD(r.fecha_inicio),
                                fecha_fin: fechaYMD(r.fecha_fin)
                            });
                            terminar();
                        });
                    });
                }
                terminar(); // este recurso ya está procesado
            });
        });
    });
}

// POST al Ministerio con todas las reservas. Se usa fetch y no rest.js porque
// rest.js hace JSON.parse de la respuesta y el Ministerio puede no devolver JSON
function enviarAlMinisterio() {
    var boton = document.getElementById("btn_ministerio");
    boton.disabled = true;

    construirPaquete(function(paquete) {
        if (paquete == null) {
            alert("No se han podido obtener las reservas.");
            boton.disabled = false;
            return;
        }
        if (paquete.datos.length == 0) {
            alert("No hay reservas para enviar.");
            boton.disabled = false;
            return;
        }

        fetch(URL_MINISTERIO, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(paquete)
        })
        .then(function(resp) {
            if (resp.ok) {
                alert("Se han enviado " + paquete.datos.length + " reservas al Ministerio.");
                cargarRanking();
            } else {
                alert("El Ministerio ha rechazado el envío (HTTP " + resp.status + ").");
            }
        })
        .catch(function(err) {
            console.error("Error al enviar al Ministerio:", err);
            alert("Error de red al enviar al Ministerio.");
        })
        .finally(function() {
            boton.disabled = false;
        });
    });
}

// GET al Ministerio: cuenta las reservas de cada área y las muestra ordenadas
function cargarRanking() {
    var tbody = document.getElementById("tbody_ranking");
    tbody.innerHTML = "<tr><td colspan='3'>Cargando...</td></tr>";

    fetch(URL_MINISTERIO)
    .then(function(resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.json();
    })
    .then(function(lista) {
        // Cada elemento es un envío: { id_area, fecha, datos: [reservas...] }
        var totales = {}; // { id_area: número de reservas }
        lista.forEach(function(envio) {
            // Se ignoran los envíos mal formados que puedan haber subido otros
            if (!envio.id_area || !Array.isArray(envio.datos)) return;
            totales[envio.id_area] = (totales[envio.id_area] || 0) + envio.datos.length;
        });

        var filas = Object.keys(totales).map(function(id) {
            return { id: id, total: totales[id] };
        });
        filas.sort(function(a, b) { return b.total - a.total; });

        tbody.innerHTML = "";
        if (filas.length == 0) {
            tbody.innerHTML = "<tr><td colspan='3'>Sin datos disponibles.</td></tr>";
            return;
        }
        var medallas = ["🥇", "🥈", "🥉"];
        filas.forEach(function(f, i) {
            tbody.innerHTML += "<tr>"
                + "<td>" + (medallas[i] || (i + 1)) + "</td>"
                + "<td>" + (AREAS[f.id] || "Área " + f.id) + "</td>"
                + "<td>" + f.total.toLocaleString("es-ES") + "</td>"
                + "</tr>";
        });
    })
    .catch(function(err) {
        console.error("Error al cargar el ranking:", err);
        tbody.innerHTML = "<tr><td colspan='3'>Error al cargar el ranking.</td></tr>";
    });
}
