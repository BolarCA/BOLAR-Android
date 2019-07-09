package com.example.admin.bolar.tenantmain;

import android.provider.ContactsContract;
import android.util.Log;

import androidx.annotation.NonNull;

import com.google.android.gms.tasks.Continuation;
import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.functions.FirebaseFunctions;
import com.google.firebase.functions.FirebaseFunctionsException;
import com.google.firebase.functions.HttpsCallableResult;
import com.google.gson.Gson;
import com.stripe.android.EphemeralKeyProvider;
import com.stripe.android.EphemeralKeyUpdateListener;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

public class TenantEphemeralKeyProvider implements EphemeralKeyProvider {

    private FirebaseFunctions mFunctions = FirebaseFunctions.getInstance();

    @Override
    public void createEphemeralKey(@NonNull String apiVersion, @NonNull final EphemeralKeyUpdateListener keyUpdateListener) {
        manage("").addOnCompleteListener(new OnCompleteListener<String>() {
            @Override
            public void onComplete(@NonNull Task<String> task) {
                if (!task.isSuccessful()) {
                    Exception e = task.getException();
                    if (e instanceof FirebaseFunctionsException) {
                        FirebaseFunctionsException ffe = (FirebaseFunctionsException) e;
                        FirebaseFunctionsException.Code code = ffe.getCode();
                        Object details = ffe.getDetails();
                        keyUpdateListener.onKeyUpdateFailure(0, e.getMessage());
                    }

                    // [START_EXCLUDE]
                    Log.w("TAG", "addMessage:onFailure", e);
                    return;
                    // [END_EXCLUDE]
                }

                // [START_EXCLUDE]
                final String result = task.getResult();
                keyUpdateListener.onKeyUpdate(result);
            }
        });
    }

    private Task<String> manage(String text) {
        // Create the arguments to the callable function.
        Map<String, Object> data = new HashMap<>();
        //update based on what's on stripe dashboard
        data.put("stripe_version", "2019-05-16");
        //get customer id from database and set here
        data.put("customer_id","cus_FDRLk23tmr5CGR" );
        data.put("push", true);

        return mFunctions
                .getHttpsCallable("CreateEmphemeralKey")
                .call(data)
                .continueWith(new Continuation<HttpsCallableResult, String>() {
                    @Override
                    public String then(@NonNull Task<HttpsCallableResult> task) throws Exception {
                        // This continuation runs on either success or failure, but if the task
                        // has failed then getResult() will throw an Exception which will be
                        // propagated down.
                            Gson g = new Gson();
                            String json = g.toJson(task.getResult().getData());
                            ContactsContract.Groups groups = g.fromJson(json, ContactsContract.Groups.class);
                            return json;
                    }
                });
    }
}
