package com.example.admin.bolar.signupflow;

import android.content.DialogInterface;
import android.content.Intent;
import android.os.Bundle;
import android.support.v7.app.AlertDialog;
import android.support.v7.app.AppCompatActivity;
import android.view.KeyEvent;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.TextView;

import com.android.volley.Request;
import com.android.volley.RequestQueue;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.JsonObjectRequest;
import com.android.volley.toolbox.Volley;
import com.example.admin.bolar.AddressData;
import com.example.admin.bolar.OwnerData;
import com.example.admin.bolar.R;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.SetOptions;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

public class APNnumber extends AppCompatActivity {

    private EditText apn;
    private EditText fips;
    private FirebaseFirestore db = FirebaseFirestore.getInstance();
    private FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
    private String first;
    private String last;
    private String type;
    //base URL is "https://api.estated.com" or https://sandbox.estated.com"
    private String EstatedURL = "https://api.estated.com/property/v3?token=5YRyKBirYoAXYMJQjbJQaxLwcyuzbp";
    private String apnNum;
    private String fipsCode;
    private RequestQueue requestQueue;
    private JsonObjectRequest objectRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_apnnumber);

        Intent intent = getIntent();
        first = intent.getStringExtra("firstName");
        last = intent.getStringExtra("lastName");
        type = intent.getStringExtra("type");

        apn = findViewById(R.id.apnEdit);
        fips = findViewById(R.id.fipsEdit);

        //When they are done typing and hit enter
        apn.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                boolean handled = false;
                if (actionId == EditorInfo.IME_ACTION_DONE) {
                    handled = true;
                    apnNum = apn.getText().toString();
                    //getApnData();
                }
                return handled;
            }
        });
        fips.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                boolean handled = false;
                if (actionId == EditorInfo.IME_ACTION_DONE) {
                    handled = true;
                    apnNum = apn.getText().toString();
                    fipsCode = fips.getText().toString();
                    getApnData();
                }
                return handled;
            }
        });
    }

    public void getApnData() {
        if((apnNum != null)&&(fipsCode != null)){
            String url = EstatedURL + "&fips=" + fipsCode + "&apn=" + apnNum;
            requestQueue = Volley.newRequestQueue(this);
            objectRequest = new JsonObjectRequest(
                    Request.Method.GET,
                    url,
                    null,//this is where you add parameters//edit but I just added them into the base url string and it still works
                    new Response.Listener<JSONObject>() {
                        @Override
                        public void onResponse(JSONObject response) {
                            try {
                                if(response.getBoolean("success")){
                                    storeData(response);
                                }else if(!response.getBoolean("success")){
                                    //TODO: this means error code of some sort
                                }
                            } catch (JSONException e) {
                                e.printStackTrace();
                            }
                        }
                    },
                    new Response.ErrorListener() {
                        @Override
                        public void onErrorResponse(VolleyError error) {

                        }
                    }
            );
            requestQueue.add(objectRequest);
        }
    }

    public void storeData(JSONObject response){
        try {
            JSONObject lastOwnerData = response.getJSONArray("properties").getJSONObject(0).getJSONArray("owners").getJSONObject(0);
            JSONArray addressData = response.getJSONArray("properties").getJSONObject(0).getJSONArray("addresses");

            OwnerData ownerData = OwnerData.fromJSON(lastOwnerData);

            Map<String, Object> apnObject = new HashMap<>();
            Map<String, Object> apnData = new HashMap<>();
            Map<String, Object> apnAddresses = new HashMap<>();

            for(int i = 0; i < addressData.length(); ++i){
                AddressData addressDataObject = AddressData.fromJSON(addressData.getJSONObject(i));
                apnAddresses.put("Address " + (i+1) ,addressDataObject);
            }

            apnData.put("Addresses", apnAddresses);
            apnData.put("OwnerInfo", ownerData);
            apnObject.put("APN " + apnNum, apnData);

            db.collection(type).document(user.getUid()).set(apnObject, SetOptions.merge());

            moreApnPrompt();

        } catch (JSONException e) {
            e.printStackTrace();
        }
    }

    public void moreApnPrompt(){
        AlertDialog.Builder builder1 = new AlertDialog.Builder(this);
        builder1.setMessage("Do you have another APN number to enter?");
        builder1.setCancelable(true);

        builder1.setPositiveButton(
                "Yes",
                new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface dialog, int id) {
                        dialog.cancel();
                    }
                });
        builder1.setNegativeButton(
                "No",
                new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface dialog, int id) {
                        if(type.equals("IndividualLandlord")){
                            Intent intent = new Intent(APNnumber.this , ConfirmationDetails.class);
                            intent.putExtra("type", type);
                            intent.putExtra("firstName", first);
                            intent.putExtra("lastName", last);
                            APNnumber.this.startActivity(intent);
                        }else if(type.equals("Company")){
                            Intent intent = new Intent(APNnumber.this , CompanyInfo.class);
                            intent.putExtra("type", type);
                            intent.putExtra("firstName", first);
                            intent.putExtra("lastName", last);
                            APNnumber.this.startActivity(intent);
                        }
                        dialog.cancel();
                    }
                });
        AlertDialog alert11 = builder1.create();
        alert11.show();
    }

}
